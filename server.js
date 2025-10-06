require('dotenv').config({ path: '.env.local' });

const express = require('express');
const bodyParser = require('body-parser');
const { Pool } = require('pg');
const nacl = require('tweetnacl');
const crypto = require('crypto');

const PERIOD_SELECT_SQL = `
  SELECT id, abn, tax_type, period_id, state, basis, accrued_cents, credited_to_owa_cents,
         final_liability_cents, merkle_root, running_balance_hash, anomaly_vector, thresholds
    FROM periods
   WHERE abn = $1 AND tax_type = $2 AND period_id = $3
   LIMIT 1
`;

const PERIOD_FOR_UPDATE_SQL = `${PERIOD_SELECT_SQL} FOR UPDATE`;

const PERIOD_STATE_UPDATE_SQL = `
  UPDATE periods SET state = $1, thresholds = COALESCE($2, thresholds) WHERE id = $3
`;

const PERIOD_STATE_ONLY_UPDATE_SQL = `
  UPDATE periods SET state = $1 WHERE id = $2
`;

const PERIOD_BLOCK_STATE_SQL = `
  UPDATE periods SET state = $1, thresholds = $2 WHERE id = $3
`;

const INSERT_RPT_SQL = `
  INSERT INTO rpt_tokens (abn, tax_type, period_id, payload, signature, payload_c14n, payload_sha256)
  VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7)
`;

const LATEST_RPT_SQL = `
  SELECT payload, signature FROM rpt_tokens
   WHERE abn = $1 AND tax_type = $2 AND period_id = $3
   ORDER BY id DESC LIMIT 1
`;

const LATEST_LEDGER_SQL = `
  SELECT id, balance_after_cents, hash_after
    FROM owa_ledger
   WHERE abn = $1 AND tax_type = $2 AND period_id = $3
   ORDER BY id DESC LIMIT 1
`;

const INSERT_LEDGER_SQL = `
  INSERT INTO owa_ledger (
    abn, tax_type, period_id, transfer_uuid, amount_cents, balance_after_cents,
    bank_receipt_hash, prev_hash, hash_after
  ) VALUES ($1, $2, $3, $4::uuid, $5, $6, $7, $8, $9)
  RETURNING id, balance_after_cents, hash_after
`;

const LEDGER_HISTORY_SQL = `
  SELECT id, amount_cents, balance_after_cents, bank_receipt_hash, prev_hash, hash_after, created_at
    FROM owa_ledger
   WHERE abn = $1 AND tax_type = $2 AND period_id = $3
   ORDER BY id
`;

const LATEST_RPT_EVIDENCE_SQL = `
  SELECT payload, payload_c14n, payload_sha256, signature, created_at
    FROM rpt_tokens
   WHERE abn = $1 AND tax_type = $2 AND period_id = $3
   ORDER BY id DESC LIMIT 1
`;

const HEALTH_SQL = 'SELECT now()';

const TAX_TYPES = new Set(['PAYGW', 'GST']);

function requireIdentifier(value, name) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${name}_REQUIRED`);
  }
  return value.trim();
}

function validateTaxType(taxType) {
  const normalized = requireIdentifier(taxType, 'TAX_TYPE').toUpperCase();
  if (!TAX_TYPES.has(normalized)) {
    throw new Error('UNSUPPORTED_TAX_TYPE');
  }
  return normalized;
}

function createHash(prevHash, receipt, balance) {
  return crypto
    .createHash('sha256')
    .update(`${prevHash || ''}${receipt || ''}${balance}`)
    .digest('hex');
}

function parseMaybeJson(value) {
  if (value == null) return value;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch (err) {
      return value;
    }
  }
  return value;
}

function normalizePeriod(row) {
  if (!row) return row;
  return {
    ...row,
    anomaly_vector: parseMaybeJson(row.anomaly_vector),
    thresholds: parseMaybeJson(row.thresholds),
  };
}

function createServer(options = {}) {
  const {
    pool: providedPool,
    config: providedConfig = {},
  } = options;

  const env = {
    PGHOST: providedConfig.PGHOST || process.env.PGHOST || '127.0.0.1',
    PGUSER: providedConfig.PGUSER || process.env.PGUSER || 'apgms',
    PGPASSWORD: providedConfig.PGPASSWORD || process.env.PGPASSWORD || 'apgms_pw',
    PGDATABASE: providedConfig.PGDATABASE || process.env.PGDATABASE || 'apgms',
    PGPORT: providedConfig.PGPORT || process.env.PGPORT || '5432',
    RPT_ED25519_SECRET_BASE64:
      providedConfig.RPT_ED25519_SECRET_BASE64 || process.env.RPT_ED25519_SECRET_BASE64,
    ATO_PRN: providedConfig.ATO_PRN || process.env.ATO_PRN || '1234567890',
  };

  const pool = providedPool || new Pool({
    host: env.PGHOST,
    user: env.PGUSER,
    password: env.PGPASSWORD,
    database: env.PGDATABASE,
    port: Number(env.PGPORT),
  });

  const app = express();
  app.use(bodyParser.json());

  const handler = (fn) => (req, res) =>
    Promise.resolve(fn(req, res)).catch((err) => {
      console.error(err);
      if (err?.code === '08P01') {
        return res.status(500).json({ error: 'INTERNAL', message: err.message });
      }
      const message = typeof err?.message === 'string' ? err.message : 'BAD_REQUEST';
      res.status(400).json({ error: message });
    });

  app.get('/health', handler(async (_req, res) => {
    await pool.query(HEALTH_SQL);
    res.json(['ok', 'db', true, 'up']);
  }));

  app.get('/period/status', handler(async (req, res) => {
    const abn = requireIdentifier(req.query.abn, 'ABN');
    const taxType = validateTaxType(req.query.taxType);
    const periodId = requireIdentifier(req.query.periodId, 'PERIOD_ID');

    const result = await pool.query(PERIOD_SELECT_SQL, [abn, taxType, periodId]);
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'NOT_FOUND' });
    }
    res.json({ period: normalizePeriod(result.rows[0]) });
  }));

  app.post('/rpt/issue', handler(async (req, res) => {
    const abn = requireIdentifier(req.body.abn, 'ABN');
    const taxType = validateTaxType(req.body.taxType);
    const periodId = requireIdentifier(req.body.periodId, 'PERIOD_ID');

    const periodRes = await pool.query(PERIOD_SELECT_SQL, [abn, taxType, periodId]);
    if (periodRes.rowCount === 0) {
      throw new Error('PERIOD_NOT_FOUND');
    }
    const period = normalizePeriod(periodRes.rows[0]);

    if (period.state !== 'CLOSING') {
      return res.status(409).json({ error: 'BAD_STATE', state: period.state });
    }

    const thresholds = {
      epsilon_cents: 0,
      variance_ratio: 0.25,
      dup_rate: 0.01,
      gap_minutes: 60,
      delta_vs_baseline: 0.2,
    };

    const anomalyVector = period.anomaly_vector || {};
    const exceeds =
      (Number(anomalyVector.variance_ratio) || 0) > thresholds.variance_ratio ||
      (Number(anomalyVector.dup_rate) || 0) > thresholds.dup_rate ||
      (Number(anomalyVector.gap_minutes) || 0) > thresholds.gap_minutes ||
      Math.abs(Number(anomalyVector.delta_vs_baseline) || 0) > thresholds.delta_vs_baseline;

    const epsilon = Math.abs(
      Number(period.final_liability_cents || 0) - Number(period.credited_to_owa_cents || 0),
    );

    if (exceeds) {
      await pool.query(PERIOD_BLOCK_STATE_SQL, ['BLOCKED_ANOMALY', thresholds, period.id]);
      return res.status(409).json({ error: 'BLOCKED_ANOMALY' });
    }

    if (epsilon > thresholds.epsilon_cents) {
      await pool.query(PERIOD_BLOCK_STATE_SQL, ['BLOCKED_DISCREPANCY', thresholds, period.id]);
      return res.status(409).json({ error: 'BLOCKED_DISCREPANCY', epsilon });
    }

    const payload = {
      entity_id: period.abn,
      period_id: period.period_id,
      tax_type: period.tax_type,
      amount_cents: Number(period.final_liability_cents),
      merkle_root: period.merkle_root || null,
      running_balance_hash: period.running_balance_hash || null,
      anomaly_vector: anomalyVector,
      thresholds,
      rail_id: 'EFT',
      reference: env.ATO_PRN,
      expiry_ts: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      nonce: crypto.randomUUID(),
    };

    if (!env.RPT_ED25519_SECRET_BASE64) {
      throw new Error('NO_SK');
    }

    const payloadCanonical = JSON.stringify(payload);
    const payloadSha256 = crypto.createHash('sha256').update(payloadCanonical).digest('hex');
    const payloadBuffer = new TextEncoder().encode(payloadCanonical);
    const secretKey = Buffer.from(env.RPT_ED25519_SECRET_BASE64, 'base64');
    const signatureBytes = nacl.sign.detached(payloadBuffer, new Uint8Array(secretKey));
    const signature = Buffer.from(signatureBytes).toString('base64');

    await pool.query(INSERT_RPT_SQL, [
      abn,
      taxType,
      periodId,
      payloadCanonical,
      signature,
      payloadCanonical,
      payloadSha256,
    ]);

    await pool.query(PERIOD_STATE_UPDATE_SQL, ['READY_RPT', thresholds, period.id]);

    res.json({ payload, signature, payload_sha256: payloadSha256 });
  }));

  app.post('/release', handler(async (req, res) => {
    const abn = requireIdentifier(req.body.abn, 'ABN');
    const taxType = validateTaxType(req.body.taxType);
    const periodId = requireIdentifier(req.body.periodId, 'PERIOD_ID');

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const periodRes = await client.query(PERIOD_FOR_UPDATE_SQL, [abn, taxType, periodId]);
      if (periodRes.rowCount === 0) {
        throw new Error('PERIOD_NOT_FOUND');
      }
      const period = normalizePeriod(periodRes.rows[0]);

      if (period.state !== 'READY_RPT') {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'BAD_STATE', state: period.state });
      }

      const rptRes = await client.query(LATEST_RPT_SQL, [abn, taxType, periodId]);
      if (rptRes.rowCount === 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'NO_RPT' });
      }

      const ledgerRes = await client.query(LATEST_LEDGER_SQL, [abn, taxType, periodId]);
      const previousBalance = Number(ledgerRes.rows[0]?.balance_after_cents || 0);
      const previousHash = ledgerRes.rows[0]?.hash_after || '';

      const amount = Number(period.final_liability_cents || 0);
      if (previousBalance < amount) {
        await client.query('ROLLBACK');
        return res.status(422).json({
          error: 'INSUFFICIENT_OWA',
          prevBal: String(previousBalance),
          needed: amount,
        });
      }

      const syntheticReceipt = `rpt_debit:${crypto.randomUUID().slice(0, 12)}`;
      const newBalance = previousBalance - amount;
      const hashAfter = createHash(previousHash, syntheticReceipt, newBalance);
      const transferUuid = crypto.randomUUID();

      const insertLedger = await client.query(INSERT_LEDGER_SQL, [
        abn,
        taxType,
        periodId,
        transferUuid,
        -amount,
        newBalance,
        syntheticReceipt,
        previousHash,
        hashAfter,
      ]);

      await client.query(PERIOD_STATE_ONLY_UPDATE_SQL, ['RELEASED', period.id]);

      await client.query('COMMIT');

      const ledgerRow = insertLedger.rows[0] || {};
      res.json({
        released: true,
        bank_receipt_hash: syntheticReceipt,
        new_balance: Number(ledgerRow.balance_after_cents ?? newBalance),
        hash_after: ledgerRow.hash_after || hashAfter,
      });
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackErr) {
        console.error('rollback failed', rollbackErr);
      }
      throw err;
    } finally {
      client.release();
    }
  }));

  app.get('/evidence', handler(async (req, res) => {
    const abn = requireIdentifier(req.query.abn, 'ABN');
    const taxType = validateTaxType(req.query.taxType);
    const periodId = requireIdentifier(req.query.periodId, 'PERIOD_ID');

    const periodRes = await pool.query(PERIOD_SELECT_SQL, [abn, taxType, periodId]);
    if (periodRes.rowCount === 0) {
      return res.status(404).json({ error: 'NOT_FOUND' });
    }

    const rptRes = await pool.query(LATEST_RPT_EVIDENCE_SQL, [abn, taxType, periodId]);
    const ledgerRes = await pool.query(LEDGER_HISTORY_SQL, [abn, taxType, periodId]);

    const period = normalizePeriod(periodRes.rows[0]);
    const rptRow = rptRes.rows[0]
      ? {
          ...rptRes.rows[0],
          payload: parseMaybeJson(rptRes.rows[0].payload),
          payload_c14n: rptRes.rows[0].payload_c14n,
        }
      : null;

    res.json({
      meta: { generated_at: new Date().toISOString(), abn, taxType, periodId },
      period: {
        state: period.state,
        accrued_cents: Number(period.accrued_cents || 0),
        credited_to_owa_cents: Number(period.credited_to_owa_cents || 0),
        final_liability_cents: Number(period.final_liability_cents || 0),
        merkle_root: period.merkle_root,
        running_balance_hash: period.running_balance_hash,
        anomaly_vector: period.anomaly_vector,
        thresholds: period.thresholds,
      },
      rpt: rptRow,
      owa_ledger: ledgerRes.rows.map((row) => ({
        ...row,
        amount_cents: Number(row.amount_cents || 0),
        balance_after_cents: Number(row.balance_after_cents || 0),
      })),
      bas_labels: { W1: null, W2: null, '1A': null, '1B': null },
      discrepancy_log: [],
    });
  }));

  return {
    app,
    pool,
    start(port = Number(process.env.PORT || 8080)) {
      const server = app.listen(port, () => {
        console.log(`APGMS demo API listening on ${port}`);
      });
      return server;
    },
  };
}

if (require.main === module) {
  const { start } = createServer();
  start();
}

module.exports = { createServer };

