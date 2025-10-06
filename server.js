require('dotenv').config({ path: '.env.local' });
const express = require('express');
const bodyParser = require('body-parser');
const { Pool } = require('pg');
const nacl = require('tweetnacl');
const crypto = require('crypto');
const { parse: parseCsv } = require('csv-parse/sync');

const app = express();
app.use(bodyParser.text({ type: ['text/csv', 'text/plain'] }));
app.use(bodyParser.json());

const {
  PGHOST='127.0.0.1', PGUSER='apgms', PGPASSWORD='apgms_pw', PGDATABASE='apgms', PGPORT='5432',
  RPT_ED25519_SECRET_BASE64, RPT_PUBLIC_BASE64, ATO_PRN='1234567890',
  MOCK_BANK_ENABLED='false', MOCK_BANK_STRAGGLER_DAYS='2'
} = process.env;

const toBool = (value) => String(value ?? '').toLowerCase() === 'true';
const mockBankEnabled = toBool(MOCK_BANK_ENABLED);
const mockBankStragglerDays = Number.isFinite(Number(MOCK_BANK_STRAGGLER_DAYS))
  ? Number(MOCK_BANK_STRAGGLER_DAYS)
  : 2;

const pool = new Pool({
  host: PGHOST, user: PGUSER, password: PGPASSWORD, database: PGDATABASE, port: +PGPORT
});

// small async handler wrapper
const ah = fn => (req,res)=>fn(req,res).catch(e=>{
  console.error(e);
  if (e.code === '08P01') return res.status(500).json({error:'INTERNAL', message:e.message});
  res.status(400).json({error: e.message || 'BAD_REQUEST'});
});

// ---------- MOCK BANK (PROTOTYPE) ----------
app.post('/mock/bank/ingest', ah(async (req,res)=>{
  if (!mockBankEnabled) return res.status(404).json({error:'DISABLED'});

  const csvPayload = typeof req.body === 'string' ? req.body : req.body?.csv;
  if (!csvPayload || !String(csvPayload).trim()) throw new Error('CSV_REQUIRED');

  let rows;
  try {
    rows = parseCsv(csvPayload, { columns: true, skip_empty_lines: true, trim: true });
  } catch (err) {
    console.error('mock bank csv parse error', err);
    throw new Error('CSV_PARSE_ERROR');
  }

  if (!Array.isArray(rows) || rows.length === 0) {
    return res.json({ batch_id: null, inserted: 0, duplicates: 0, payouts: [] });
  }

  const source = typeof req.body === 'object' && req.body !== null && req.body.source
    ? String(req.body.source)
    : 'manual';

  const client = await pool.connect();
  const summary = new Map();
  let insertedLines = 0;
  let duplicateLines = 0;

  try {
    await client.query('begin');
    const batch = await client.query(
      'insert into mock_bank_batches(source, raw_csv) values($1,$2) returning id',
      [source, csvPayload]
    );
    const batchId = batch.rows[0].id;

    for (const rawRow of rows) {
      const lineId = String(rawRow.line_id || '').trim();
      if (!lineId) throw new Error('LINE_ID_REQUIRED');

      const rptId = String(rawRow.rpt_id || '').trim();
      if (!rptId) throw new Error('RPT_ID_REQUIRED');

      const amountRaw = String(rawRow.amount_cents ?? '').replace(/[,\s]/g, '');
      if (!/^[-+]?\d+$/.test(amountRaw)) throw new Error(`INVALID_AMOUNT:${lineId}`);
      const amount = Number.parseInt(amountRaw, 10);
      if (!Number.isSafeInteger(amount)) throw new Error(`INVALID_AMOUNT:${lineId}`);

      const statementDateStr = String(rawRow.statement_date || '').trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(statementDateStr)) throw new Error(`INVALID_STATEMENT_DATE:${lineId}`);

      let postedAtIso;
      try {
        const posted = new Date(rawRow.posted_at);
        if (Number.isNaN(posted.getTime())) throw new Error('bad');
        postedAtIso = posted.toISOString();
      } catch (err) {
        console.error('mock bank invalid posted_at', err);
        throw new Error(`INVALID_POSTED_AT:${lineId}`);
      }

      const part = Number.parseInt(String(rawRow.part ?? '1'), 10);
      const parts = Number.parseInt(String(rawRow.parts ?? '1'), 10);
      if (!Number.isInteger(part) || part < 1) throw new Error(`INVALID_PART:${lineId}`);
      if (!Number.isInteger(parts) || parts < part) throw new Error(`INVALID_PARTS:${lineId}`);

      const description = String(rawRow.description || '').trim() || null;
      const normalized = {
        line_id: lineId,
        rpt_id: rptId,
        amount_cents: amount,
        statement_date: statementDateStr,
        posted_at: postedAtIso,
        description,
        part,
        parts,
        duplicate_of: rawRow.duplicate_of || null
      };

      const inserted = await client.query(
        `insert into mock_bank_statement_lines
           (batch_id, line_id, rpt_id, part_no, parts, amount_cents, statement_date, posted_at, raw)
         values ($1,$2,$3,$4,$5,$6,$7::date,$8::timestamptz,$9::jsonb)
         on conflict (line_id) do nothing
         returning id`,
        [batchId, lineId, rptId, part, parts, amount, statementDateStr, postedAtIso, JSON.stringify(normalized)]
      );

      if (inserted.rowCount === 0) {
        duplicateLines += 1;
        continue;
      }

      insertedLines += 1;

      const payout = await client.query(
        `insert into mock_bank_payouts
           (batch_id, rpt_id, statement_date, posted_at, amount_cents, parts_count, metadata)
         values ($1,$2,$3::date,$4::timestamptz,$5,$6,
           jsonb_build_object('last_line_id',$7::text,'last_description',$8::text))
         on conflict (rpt_id) do update
           set amount_cents = mock_bank_payouts.amount_cents + excluded.amount_cents,
               posted_at = greatest(mock_bank_payouts.posted_at, excluded.posted_at),
               statement_date = least(mock_bank_payouts.statement_date, excluded.statement_date),
               parts_count = greatest(mock_bank_payouts.parts_count, excluded.parts_count),
               batch_id = excluded.batch_id,
               metadata = jsonb_set(
                 jsonb_set(coalesce(mock_bank_payouts.metadata,'{}'::jsonb), '{last_line_id}', to_jsonb($7::text), true),
                 '{last_description}', to_jsonb($8::text), true
               ),
               updated_at = now()
         returning id, amount_cents, parts_count, posted_at`,
        [batchId, rptId, statementDateStr, postedAtIso, amount, parts, lineId, description]
      );

      const payoutId = payout.rows[0].id;
      const statementLineId = inserted.rows[0].id;

      await client.query(
        'update mock_bank_statement_lines set payout_id=$1 where id=$2',
        [payoutId, statementLineId]
      );

      await client.query(
        `insert into mock_bank_payout_parts (payout_id, part_no, amount_cents, posted_at, statement_line_id)
         values ($1,$2,$3,$4::timestamptz,$5)
         on conflict (payout_id, part_no) do update
           set amount_cents = excluded.amount_cents,
               posted_at = excluded.posted_at,
               statement_line_id = excluded.statement_line_id`,
        [payoutId, part, amount, postedAtIso, lineId]
      );

      const existing = summary.get(rptId) || {
        amount_cents: 0,
        received_parts: 0,
        expected_parts: parts,
        latest_posted_at: postedAtIso
      };
      existing.amount_cents += amount;
      existing.received_parts += 1;
      existing.expected_parts = Math.max(existing.expected_parts, parts);
      if (new Date(postedAtIso) > new Date(existing.latest_posted_at)) {
        existing.latest_posted_at = postedAtIso;
      }
      summary.set(rptId, existing);
    }

    await client.query('commit');

    res.json({
      batch_id: batchId,
      inserted: insertedLines,
      duplicates: duplicateLines,
      payouts: Array.from(summary.entries()).map(([rptId, info]) => ({
        rpt_id: rptId,
        amount_cents: String(info.amount_cents),
        received_parts: info.received_parts,
        expected_parts: info.expected_parts,
        latest_posted_at: info.latest_posted_at
      }))
    });
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }
}));

app.get('/mock/bank/unreconciled', ah(async (req,res)=>{
  if (!mockBankEnabled) return res.status(404).json({error:'DISABLED'});

  const statuses = req.query.status
    ? String(req.query.status).split(',').map(s => s.trim().toUpperCase()).filter(Boolean)
    : [];

  const whereClause = statuses.length ? 'where p.status = any($1)' : "where p.status <> 'SETTLED'";
  const params = statuses.length ? [statuses] : [];

  const rows = await pool.query(
    `select p.rpt_id, p.amount_cents, p.statement_date, p.posted_at, p.parts_count, p.status,
            coalesce(json_agg(json_build_object(
              'part_no', pr.part_no,
              'amount_cents', pr.amount_cents,
              'posted_at', pr.posted_at,
              'statement_line_id', pr.statement_line_id
            ) order by pr.part_no) filter (where pr.id is not null), '[]'::json) as parts
       from mock_bank_payouts p
       left join mock_bank_payout_parts pr on pr.payout_id = p.id
       ${whereClause}
       group by p.id
       order by p.posted_at asc`,
    params
  );

  const now = Date.now();
  const stragglerMs = Number.isFinite(mockBankStragglerDays) && mockBankStragglerDays > 0
    ? mockBankStragglerDays * 24 * 60 * 60 * 1000
    : null;

  const payload = rows.rows.map(row => {
    const postedAt = new Date(row.posted_at);
    const ageMs = now - postedAt.getTime();
    const parts = Array.isArray(row.parts) ? row.parts : [];
    return {
      rpt_id: row.rpt_id,
      status: row.status,
      amount_cents: row.amount_cents,
      statement_date: row.statement_date,
      posted_at: row.posted_at,
      expected_parts: row.parts_count,
      received_parts: parts.length,
      parts,
      age_hours: Math.round((ageMs / 36e5) * 100) / 100,
      is_straggler: stragglerMs ? ageMs > stragglerMs : false
    };
  });

  res.json({ unreconciled: payload });
}));

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