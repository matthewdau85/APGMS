require('dotenv').config({ path: '.env.local' });
const express = require('express');
const bodyParser = require('body-parser');
const { Pool } = require('pg');
const nacl = require('tweetnacl');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const client = require('prom-client');

const app = express();
app.use(bodyParser.json());
client.collectDefaultMetrics();

const {
  PGHOST='127.0.0.1', PGUSER='apgms', PGPASSWORD='apgms_pw', PGDATABASE='apgms', PGPORT='5432',
  RPT_ED25519_SECRET_BASE64, RPT_PUBLIC_BASE64, ATO_PRN='1234567890',
  ACTIVE_RULE_VERSION
} = process.env;

const pool = new Pool({
  host: PGHOST, user: PGUSER, password: PGPASSWORD, database: PGDATABASE, port: +PGPORT
});

const releaseSuccessCounter = new client.Counter({
  name: 'apgms_release_success_total',
  help: 'Number of successful /release calls',
});
const releaseFailureCounter = new client.Counter({
  name: 'apgms_release_failure_total',
  help: 'Number of failed /release calls',
});
const releaseSuccessRatioGauge = new client.Gauge({
  name: 'apgms_release_success_ratio',
  help: 'Share of successful releases in this process lifetime',
});
const dlqBacklogGauge = new client.Gauge({
  name: 'apgms_dlq_backlog',
  help: 'Periods blocked or awaiting manual intervention',
});
const ruleDriftGauge = new client.Gauge({
  name: 'apgms_rule_drift',
  help: '1 when active rule version differs from expected baseline',
});
const ruleVersionInfo = new client.Gauge({
  name: 'apgms_rules_version_info',
  help: 'Metadata about the loaded PAYGW/GST rules',
  labelNames: ['version', 'period'],
});

let releaseSuccessCount = 0;
let releaseFailureCount = 0;

const rulesPath = path.join(__dirname, 'apps', 'services', 'tax-engine', 'app', 'rules');
try {
  const ruleFile = fs.readdirSync(rulesPath).find((file) => file.endsWith('.json'));
  if (ruleFile) {
    const raw = fs.readFileSync(path.join(rulesPath, ruleFile), 'utf8').replace(/^\uFEFF/, '');
    const parsed = JSON.parse(raw);
    const version = parsed.version || 'unknown';
    const period = (parsed.formula_progressive && parsed.formula_progressive.period) || 'unknown';
    ruleVersionInfo.labels(version, period).set(1);
    if (ACTIVE_RULE_VERSION) {
      ruleDriftGauge.set(version === ACTIVE_RULE_VERSION ? 0 : 1);
    }
  }
} catch (err) {
  console.warn('Unable to load rule metadata for drift detection', err);
}

async function refreshOperationalGauges() {
  try {
    const backlog = await pool.query(
      "select count(*) as cnt from periods where state in ('BLOCKED_ANOMALY','BLOCKED_DISCREPANCY')"
    );
    dlqBacklogGauge.set(Number(backlog.rows[0]?.cnt || 0));
  } catch (err) {
    console.warn('Failed to refresh DLQ backlog gauge', err);
  }
  const total = releaseSuccessCount + releaseFailureCount;
  releaseSuccessRatioGauge.set(total === 0 ? 1 : releaseSuccessCount / total);
}

// small async handler wrapper
const ah = fn => (req,res)=>fn(req,res).catch(e=>{
  console.error(e);
  if (e.code === '08P01') return res.status(500).json({error:'INTERNAL', message:e.message});
  res.status(400).json({error: e.message || 'BAD_REQUEST'});
});

// ---------- HEALTH ----------
app.get('/health', ah(async (req,res)=>{
  await pool.query('select now()');
  res.json(['ok','db', true, 'up']);
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
  let failureRecorded = false;
  try {

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
    if (rr.rowCount===0) {
      failureRecorded = true;
      releaseFailureCounter.inc();
      releaseFailureCount += 1;
      return res.status(400).json({error:'NO_RPT'});
    }

    // ensure funds exist
    const lr = await pool.query(
      select balance_after_cents from owa_ledger
         where abn= and tax_type= and period_id=
         order by id desc limit 1,
      [abn, taxType, periodId]
    );
    const prevBal = lr.rows[0]?.balance_after_cents ?? 0;
    const amt = Number(p.final_liability_cents);
    if (prevBal < amt) {
      failureRecorded = true;
      releaseFailureCounter.inc();
      releaseFailureCount += 1;
      return res.status(422).json({error:'INSUFFICIENT_OWA', prevBal: String(prevBal), needed: amt});
    }

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
    releaseSuccessCounter.inc();
    releaseSuccessCount += 1;
    res.json({ released: true, bank_receipt_hash: synthetic, new_balance: newBalance });
    await refreshOperationalGauges();
  } catch (err) {
    if (!failureRecorded) {
      releaseFailureCounter.inc();
      releaseFailureCount += 1;
    }
    throw err;
  }
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

app.get('/metrics', async (req, res) => {
  await refreshOperationalGauges();
  res.set('Content-Type', client.register.contentType);
  res.end(await client.register.metrics());
});

const port = process.env.PORT ? +process.env.PORT : 8080;
app.listen(port, ()=> console.log(APGMS demo API listening on :));