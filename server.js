require('dotenv').config({ path: '.env.local' });
const express = require('express');
const bodyParser = require('body-parser');
const { pool, getPoolMetrics } = require('./server/db/pool');
const nacl = require('tweetnacl');
const crypto = require('crypto');

const app = express();
app.use(bodyParser.json());

const {
  RPT_ED25519_SECRET_BASE64, RPT_PUBLIC_BASE64, ATO_PRN='1234567890'
} = process.env;

// small async handler wrapper
const ah = fn => (req,res)=>fn(req,res).catch(e=>{
  console.error(e);
  if (e.code === '08P01') return res.status(500).json({error:'INTERNAL', message:e.message});
  res.status(400).json({error: e.message || 'BAD_REQUEST'});
});

// ---------- HEALTH ----------
app.get('/health', ah(async (req,res)=>{
  await pool.query('select now()');
  const metrics = getPoolMetrics();
  res.json(['ok','db', true, 'up', { pool: metrics }]);
}));

// ---------- PERIOD STATUS ----------
app.get('/period/status', ah(async (req,res)=>{
  const {abn, taxType, periodId} = req.query;
  const r = await pool.query(
    select * from periods where abn= and tax_type= and period_id=,
    [abn, taxType, periodId]
  );
  if (r.rowCount===0) return res.status(404).json({error:'NOT_FOUND'});
  res.json({ period: r.rows[0] });
}));

// ---------- RPT ISSUE ----------
app.post('/rpt/issue', ah(async (req,res)=>{
  const {abn, taxType, periodId} = req.body;
  const pr = await pool.query(
    select * from periods where abn= and tax_type= and period_id=,
    [abn, taxType, periodId]
  );
  if (pr.rowCount===0) throw new Error('PERIOD_NOT_FOUND');
  const p = pr.rows[0];

  if (p.state !== 'CLOSING') return res.status(409).json({error:'BAD_STATE', state:p.state});

  // simple anomaly thresholds (demo)
  const thresholds = { epsilon_cents: 0, variance_ratio: 0.25, dup_rate: 0.01, gap_minutes: 60, delta_vs_baseline: 0.2 };
  const v = p.anomaly_vector || {};
  const exceeds =
    (v.variance_ratio || 0) > thresholds.variance_ratio ||
    (v.dup_rate || 0) > thresholds.dup_rate ||
    (v.gap_minutes || 0) > thresholds.gap_minutes ||
    Math.abs((v.delta_vs_baseline || 0)) > thresholds.delta_vs_baseline;

  if (exceeds) {
    await pool.query(update periods set state='BLOCKED_ANOMALY' where id=, [p.id]);
    return res.status(409).json({error:'BLOCKED_ANOMALY'});
  }

  const epsilon = Math.abs(Number(p.final_liability_cents) - Number(p.credited_to_owa_cents));
  if (epsilon > thresholds.epsilon_cents) {
    await pool.query(update periods set state='BLOCKED_DISCREPANCY' where id=, [p.id]);
    return res.status(409).json({error:'BLOCKED_DISCREPANCY', epsilon});
  }

  // patent-critical: canonical payload string + sha256 saved alongside signature
  const payload = {
    entity_id: p.abn,
    period_id: p.period_id,
    tax_type: p.tax_type,
    amount_cents: Number(p.final_liability_cents),
    merkle_root: p.merkle_root || null,
    running_balance_hash: p.running_balance_hash || null,
    anomaly_vector: v,
    thresholds,
    rail_id: "EFT",
    reference: ATO_PRN,
    expiry_ts: new Date(Date.now() + 15*60*1000).toISOString(),
    nonce: crypto.randomUUID()
  };

  const payloadStr = JSON.stringify(payload);
  const payloadSha256 = crypto.createHash('sha256').update(payloadStr).digest('hex');
  const msg = new TextEncoder().encode(payloadStr);

  if (!RPT_ED25519_SECRET_BASE64) throw new Error('NO_SK');
  const skBuf = Buffer.from(RPT_ED25519_SECRET_BASE64, 'base64');
  const sig = nacl.sign.detached(msg, new Uint8Array(skBuf));
  const signature = Buffer.from(sig).toString('base64');

  // 7 params insert (payload_c14n + payload_sha256)
  await pool.query(
    insert into rpt_tokens(abn,tax_type,period_id,payload,signature,payload_c14n,payload_sha256)
     values (,,,,,,),
    [abn, taxType, periodId, payload, signature, payloadStr, payloadSha256]
  );

  await pool.query(update periods set state='READY_RPT' where id=, [p.id]);
  res.json({ payload, signature, payload_sha256: payloadSha256 });
}));

// ---------- RELEASE (debit from OWA; uses owa_append OUT cols) ----------
app.post('/release', ah(async (req,res)=>{
  const {abn, taxType, periodId} = req.body;

  const pr = await pool.query(
    select * from periods where abn= and tax_type= and period_id=,
    [abn, taxType, periodId]
  );
  if (pr.rowCount===0) throw new Error('PERIOD_NOT_FOUND');
  const p = pr.rows[0];

  // need latest token
  const rr = await pool.query(
    select payload, signature from rpt_tokens
     where abn= and tax_type= and period_id=
     order by id desc limit 1,
    [abn, taxType, periodId]
  );
  if (rr.rowCount===0) return res.status(400).json({error:'NO_RPT'});

  // ensure funds exist
  const lr = await pool.query(
    select balance_after_cents from owa_ledger
       where abn= and tax_type= and period_id=
       order by id desc limit 1,
    [abn, taxType, periodId]
  );
  const prevBal = lr.rows[0]?.balance_after_cents ?? 0;
  const amt = Number(p.final_liability_cents);
  if (prevBal < amt) return res.status(422).json({error:'INSUFFICIENT_OWA', prevBal: String(prevBal), needed: amt});

  // do the debit
  const synthetic = 'rpt_debit:' + crypto.randomUUID().slice(0,12);
  const r = await pool.query(select * from owa_append(,,,,),
    [abn, taxType, periodId, -amt, synthetic]);

  let newBalance = null;
  if (r.rowCount && r.rows[0] && r.rows[0].out_balance_after != null) {
    newBalance = r.rows[0].out_balance_after;
  } else {
    // fallback: read back most recent balance if no row returned
    const fr = await pool.query(
      select balance_after_cents as bal from owa_ledger
       where abn= and tax_type= and period_id=
       order by id desc limit 1,
      [abn, taxType, periodId]
    );
    newBalance = fr.rows[0]?.bal ?? (prevBal - amt);
  }

  await pool.query(update periods set state='RELEASED' where id=, [p.id]);
  res.json({ released: true, bank_receipt_hash: synthetic, new_balance: newBalance });
}));

// ---------- EVIDENCE ----------
app.get('/evidence', ah(async (req,res)=>{
  const {abn, taxType, periodId} = req.query;
  const pr = await pool.query(
    select * from periods where abn= and tax_type= and period_id=,
    [abn, taxType, periodId]
  );
  if (pr.rowCount===0) return res.status(404).json({error:'NOT_FOUND'});
  const p = pr.rows[0];

  const rr = await pool.query(
    select payload, payload_c14n, payload_sha256, signature, created_at
       from rpt_tokens
      where abn= and tax_type= and period_id=
      order by id desc limit 1,
    [abn, taxType, periodId]
  );
  const rpt = rr.rows[0] || null;

  const lr = await pool.query(
    select id, amount_cents, balance_after_cents, bank_receipt_hash, prev_hash, hash_after, created_at
       from owa_ledger
      where abn= and tax_type= and period_id=
      order by id,
    [abn, taxType, periodId]
  );

  const basLabels = { W1:null, W2:null, "1A":null, "1B":null };

  res.json({
    meta: { generated_at: new Date().toISOString(), abn, taxType, periodId },
    period: {
      state: p.state,
      accrued_cents: Number(p.accrued_cents||0),
      credited_to_owa_cents: Number(p.credited_to_owa_cents||0),
      final_liability_cents: Number(p.final_liability_cents||0),
      merkle_root: p.merkle_root,
      running_balance_hash: p.running_balance_hash,
      anomaly_vector: p.anomaly_vector,
      thresholds: p.thresholds
    },
    rpt,
    owa_ledger: lr.rows,
    bas_labels: basLabels,
    discrepancy_log: []
  });
}));

const port = process.env.PORT ? +process.env.PORT : 8080;
app.listen(port, ()=> console.log(APGMS demo API listening on :));