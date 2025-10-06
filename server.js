require('ts-node/register');
require('dotenv').config({ path: '.env.local' });
const express = require('express');
const bodyParser = require('body-parser');
const nacl = require('tweetnacl');
const crypto = require('crypto');
const { pool } = require('./src/db/pool');
const { sql } = require('./src/db/sql');
const { idempotency } = require('./src/middleware/idempotency');
const { createErrorHandler } = require('./src/middleware/errorHandler');

const app = express();
app.use(bodyParser.json());

const { RPT_ED25519_SECRET_BASE64, ATO_PRN = '1234567890' } = process.env;

app.use((req, res, next) => {
  const requestId = crypto.randomUUID();
  req.requestId = requestId;
  res.setHeader('x-request-id', requestId);
  next();
});

const ah = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

app.get('/health', ah(async (_req, res) => {
  const query = sql`SELECT 1`;
  await pool.query(query.text, query.params);
  res.json(['ok', 'db', true, 'up']);
}));

app.get('/period/status', ah(async (req, res) => {
  const { abn, taxType, periodId } = req.query;
  const query = sql`
    SELECT * FROM periods WHERE abn=${abn} AND tax_type=${taxType} AND period_id=${periodId}
  `;
  const r = await pool.query(query.text, query.params);
  if (r.rowCount === 0) return res.status(404).json({ error: 'NOT_FOUND' });
  res.json({ period: r.rows[0] });
}));

app.post('/rpt/issue', idempotency(), ah(async (req, res) => {
  const { abn, taxType, periodId } = req.body;
  const periodQuery = sql`
    SELECT * FROM periods WHERE abn=${abn} AND tax_type=${taxType} AND period_id=${periodId}
  `;
  const pr = await pool.query(periodQuery.text, periodQuery.params);
  if (pr.rowCount === 0) throw new Error('PERIOD_NOT_FOUND');
  const p = pr.rows[0];

  if (p.state !== 'CLOSING') return res.status(409).json({ error: 'BAD_STATE', state: p.state });

  const thresholds = { epsilon_cents: 0, variance_ratio: 0.25, dup_rate: 0.01, gap_minutes: 60, delta_vs_baseline: 0.2 };
  const v = p.anomaly_vector || {};
  const exceeds =
    (v.variance_ratio || 0) > thresholds.variance_ratio ||
    (v.dup_rate || 0) > thresholds.dup_rate ||
    (v.gap_minutes || 0) > thresholds.gap_minutes ||
    Math.abs((v.delta_vs_baseline || 0)) > thresholds.delta_vs_baseline;

  if (exceeds) {
    const updateQuery = sql`UPDATE periods SET state='BLOCKED_ANOMALY' WHERE id=${p.id}`;
    await pool.query(updateQuery.text, updateQuery.params);
    return res.status(409).json({ error: 'BLOCKED_ANOMALY' });
  }

  const epsilon = Math.abs(Number(p.final_liability_cents) - Number(p.credited_to_owa_cents));
  if (epsilon > thresholds.epsilon_cents) {
    const updateQuery = sql`UPDATE periods SET state='BLOCKED_DISCREPANCY' WHERE id=${p.id}`;
    await pool.query(updateQuery.text, updateQuery.params);
    return res.status(409).json({ error: 'BLOCKED_DISCREPANCY', epsilon });
  }

  const payload = {
    entity_id: p.abn,
    period_id: p.period_id,
    tax_type: p.tax_type,
    amount_cents: Number(p.final_liability_cents),
    merkle_root: p.merkle_root || null,
    running_balance_hash: p.running_balance_hash || null,
    anomaly_vector: v,
    thresholds,
    rail_id: 'EFT',
    reference: ATO_PRN,
    expiry_ts: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    nonce: crypto.randomUUID()
  };

  const payloadStr = JSON.stringify(payload);
  const payloadSha256 = crypto.createHash('sha256').update(payloadStr).digest('hex');
  const msg = new TextEncoder().encode(payloadStr);

  if (!RPT_ED25519_SECRET_BASE64) throw new Error('NO_SK');
  const skBuf = Buffer.from(RPT_ED25519_SECRET_BASE64, 'base64');
  const sig = nacl.sign.detached(msg, new Uint8Array(skBuf));
  const signature = Buffer.from(sig).toString('base64');

  const insertToken = sql`
    INSERT INTO rpt_tokens(abn,tax_type,period_id,payload,signature,payload_c14n,payload_sha256)
    VALUES (${abn},${taxType},${periodId},${payload},${signature},${payloadStr},${payloadSha256})
  `;
  await pool.query(insertToken.text, insertToken.params);

  const updatePeriod = sql`UPDATE periods SET state='READY_RPT' WHERE id=${p.id}`;
  await pool.query(updatePeriod.text, updatePeriod.params);
  res.json({ payload, signature, payload_sha256: payloadSha256 });
}));

app.post('/release', idempotency(), ah(async (req, res) => {
  const { abn, taxType, periodId } = req.body;

  const periodQuery = sql`
    SELECT * FROM periods WHERE abn=${abn} AND tax_type=${taxType} AND period_id=${periodId}
  `;
  const pr = await pool.query(periodQuery.text, periodQuery.params);
  if (pr.rowCount === 0) throw new Error('PERIOD_NOT_FOUND');
  const p = pr.rows[0];

  const rptQuery = sql`
    SELECT payload, signature FROM rpt_tokens
     WHERE abn=${abn} AND tax_type=${taxType} AND period_id=${periodId}
     ORDER BY id DESC LIMIT 1
  `;
  const rr = await pool.query(rptQuery.text, rptQuery.params);
  if (rr.rowCount === 0) return res.status(400).json({ error: 'NO_RPT' });

  const ledgerQuery = sql`
    SELECT balance_after_cents FROM owa_ledger
     WHERE abn=${abn} AND tax_type=${taxType} AND period_id=${periodId}
     ORDER BY id DESC LIMIT 1
  `;
  const lr = await pool.query(ledgerQuery.text, ledgerQuery.params);
  const prevBal = lr.rows[0]?.balance_after_cents ?? 0;
  const amt = Number(p.final_liability_cents);
  if (prevBal < amt) return res.status(422).json({ error: 'INSUFFICIENT_OWA', prevBal: String(prevBal), needed: amt });

  const synthetic = 'rpt_debit:' + crypto.randomUUID().slice(0, 12);
  const appendQuery = sql`SELECT * FROM owa_append(${abn},${taxType},${periodId},${-amt},${synthetic})`;
  const r = await pool.query(appendQuery.text, appendQuery.params);

  let newBalance = null;
  if (r.rowCount && r.rows[0] && r.rows[0].out_balance_after != null) {
    newBalance = r.rows[0].out_balance_after;
  } else {
    const fallbackQuery = sql`
      SELECT balance_after_cents AS bal FROM owa_ledger
       WHERE abn=${abn} AND tax_type=${taxType} AND period_id=${periodId}
       ORDER BY id DESC LIMIT 1
    `;
    const fr = await pool.query(fallbackQuery.text, fallbackQuery.params);
    newBalance = fr.rows[0]?.bal ?? (prevBal - amt);
  }

  const updatePeriod = sql`UPDATE periods SET state='RELEASED' WHERE id=${p.id}`;
  await pool.query(updatePeriod.text, updatePeriod.params);
  res.json({ released: true, bank_receipt_hash: synthetic, new_balance: newBalance });
}));

app.get('/evidence', ah(async (req, res) => {
  const { abn, taxType, periodId } = req.query;
  const periodQuery = sql`
    SELECT * FROM periods WHERE abn=${abn} AND tax_type=${taxType} AND period_id=${periodId}
  `;
  const pr = await pool.query(periodQuery.text, periodQuery.params);
  if (pr.rowCount === 0) return res.status(404).json({ error: 'NOT_FOUND' });
  const p = pr.rows[0];

  const rptQuery = sql`
    SELECT payload, payload_c14n, payload_sha256, signature, created_at
      FROM rpt_tokens
     WHERE abn=${abn} AND tax_type=${taxType} AND period_id=${periodId}
     ORDER BY id DESC LIMIT 1
  `;
  const rr = await pool.query(rptQuery.text, rptQuery.params);
  const rpt = rr.rows[0] || null;

  const ledgerQuery = sql`
    SELECT id, amount_cents, balance_after_cents, bank_receipt_hash, prev_hash, hash_after, created_at
      FROM owa_ledger
     WHERE abn=${abn} AND tax_type=${taxType} AND period_id=${periodId}
     ORDER BY id
  `;
  const lr = await pool.query(ledgerQuery.text, ledgerQuery.params);

  const basLabels = { W1: null, W2: null, '1A': null, '1B': null };

  res.json({
    meta: { generated_at: new Date().toISOString(), abn, taxType, periodId },
    period: {
      state: p.state,
      accrued_cents: Number(p.accrued_cents || 0),
      credited_to_owa_cents: Number(p.credited_to_owa_cents || 0),
      final_liability_cents: Number(p.final_liability_cents || 0),
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

app.use(createErrorHandler());

const port = process.env.PORT ? +process.env.PORT : 8080;
app.listen(port, () => console.log('APGMS demo API listening on', port));
