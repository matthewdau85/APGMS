require('dotenv').config({ path: '.env.local' });
const express = require('express');
const bodyParser = require('body-parser');
const { Pool } = require('pg');
const nacl = require('tweetnacl');
const crypto = require('crypto');

function createPool() {
  const {
    PGHOST = '127.0.0.1',
    PGUSER = 'apgms',
    PGPASSWORD = 'apgms_pw',
    PGDATABASE = 'apgms',
    PGPORT = '5432'
  } = process.env;

  return new Pool({
    host: PGHOST,
    user: PGUSER,
    password: PGPASSWORD,
    database: PGDATABASE,
    port: Number(PGPORT)
  });
}

function createApp({ pool }) {
  const app = express();
  app.use(bodyParser.json());

  const asyncHandler = (fn) => (req, res) => fn(req, res).catch((e) => {
    console.error(e);
    if (e.code === '08P01') {
      return res.status(500).json({ error: 'INTERNAL', message: e.message });
    }
    res.status(400).json({ error: e.message || 'BAD_REQUEST' });
  });

  app.get('/health', asyncHandler(async (req, res) => {
    await pool.query('select now() as ts');
    res.json(['ok', 'db', true, 'up']);
  }));

  app.get('/period/status', asyncHandler(async (req, res) => {
    const { abn, taxType, periodId } = req.query;
    const result = await pool.query(
      'select * from periods where abn=$1 and tax_type=$2 and period_id=$3',
      [abn, taxType, periodId]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'NOT_FOUND' });
    }
    res.json({ period: result.rows[0] });
  }));

  app.post('/rpt/issue', asyncHandler(async (req, res) => {
    const { abn, taxType, periodId } = req.body;
    const periodResult = await pool.query(
      'select * from periods where abn=$1 and tax_type=$2 and period_id=$3',
      [abn, taxType, periodId]
    );
    if (periodResult.rowCount === 0) {
      throw new Error('PERIOD_NOT_FOUND');
    }
    const period = periodResult.rows[0];

    if (period.state !== 'CLOSING') {
      return res.status(409).json({ error: 'BAD_STATE', state: period.state });
    }

    const thresholds = {
      epsilon_cents: 0,
      variance_ratio: 0.25,
      dup_rate: 0.01,
      gap_minutes: 60,
      delta_vs_baseline: 0.2
    };
    const anomalyVector = period.anomaly_vector || {};

    const exceedsThreshold =
      (anomalyVector.variance_ratio || 0) > thresholds.variance_ratio ||
      (anomalyVector.dup_rate || 0) > thresholds.dup_rate ||
      (anomalyVector.gap_minutes || 0) > thresholds.gap_minutes ||
      Math.abs(anomalyVector.delta_vs_baseline || 0) > thresholds.delta_vs_baseline;

    if (exceedsThreshold) {
      await pool.query(
        "update periods set state='BLOCKED_ANOMALY' where id=$1",
        [period.id]
      );
      return res.status(409).json({ error: 'BLOCKED_ANOMALY' });
    }

    const epsilon = Math.abs(Number(period.final_liability_cents) - Number(period.credited_to_owa_cents));
    if (epsilon > thresholds.epsilon_cents) {
      await pool.query(
        "update periods set state='BLOCKED_DISCREPANCY' where id=$1",
        [period.id]
      );
      return res.status(409).json({ error: 'BLOCKED_DISCREPANCY', epsilon });
    }

    const {
      RPT_ED25519_SECRET_BASE64,
      ATO_PRN = '1234567890'
    } = process.env;

    if (!RPT_ED25519_SECRET_BASE64) {
      throw new Error('NO_SK');
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
      reference: ATO_PRN,
      expiry_ts: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      nonce: crypto.randomUUID()
    };

    const payloadStr = JSON.stringify(payload);
    const payloadSha256 = crypto.createHash('sha256').update(payloadStr).digest('hex');
    const msg = new TextEncoder().encode(payloadStr);

    const secretKey = Buffer.from(RPT_ED25519_SECRET_BASE64, 'base64');
    const signature = Buffer.from(
      nacl.sign.detached(msg, new Uint8Array(secretKey))
    ).toString('base64');

    await pool.query(
      'insert into rpt_tokens(abn,tax_type,period_id,payload,signature,payload_c14n,payload_sha256) values ($1,$2,$3,$4,$5,$6,$7)',
      [abn, taxType, periodId, payload, signature, payloadStr, payloadSha256]
    );

    await pool.query(
      "update periods set state='READY_RPT' where id=$1",
      [period.id]
    );

    res.json({ payload, signature, payload_sha256: payloadSha256 });
  }));

  app.post('/release', asyncHandler(async (req, res) => {
    const { abn, taxType, periodId } = req.body;
    const periodResult = await pool.query(
      'select * from periods where abn=$1 and tax_type=$2 and period_id=$3',
      [abn, taxType, periodId]
    );
    if (periodResult.rowCount === 0) {
      throw new Error('PERIOD_NOT_FOUND');
    }
    const period = periodResult.rows[0];

    const rptResult = await pool.query(
      'select payload, signature from rpt_tokens where abn=$1 and tax_type=$2 and period_id=$3 order by id desc limit 1',
      [abn, taxType, periodId]
    );
    if (rptResult.rowCount === 0) {
      return res.status(400).json({ error: 'NO_RPT' });
    }

    const ledgerResult = await pool.query(
      'select balance_after_cents from owa_ledger where abn=$1 and tax_type=$2 and period_id=$3 order by id desc limit 1',
      [abn, taxType, periodId]
    );
    const previousBalance = ledgerResult.rows[0]?.balance_after_cents ?? 0;
    const amount = Number(period.final_liability_cents);
    if (previousBalance < amount) {
      return res.status(422).json({
        error: 'INSUFFICIENT_OWA',
        prevBal: String(previousBalance),
        needed: amount
      });
    }

    const syntheticReceipt = 'rpt_debit:' + crypto.randomUUID().slice(0, 12);
    const debitQuery = `select id,
       amount_cents,
       balance_after as balance_after,
       bank_receipt_hash,
       prev_hash,
       hash_after
from owa_append($1,$2,$3,$4,$5) as t(
  id int,
  amount_cents bigint,
  balance_after bigint,
  bank_receipt_hash text,
  prev_hash text,
  hash_after text
)`;
    const debitResult = await pool.query(
      debitQuery,
      [abn, taxType, periodId, -amount, syntheticReceipt]
    );

    let newBalance = null;
    if (debitResult.rowCount && debitResult.rows[0] && debitResult.rows[0].balance_after != null) {
      newBalance = debitResult.rows[0].balance_after;
    } else {
      const fallback = await pool.query(
        'select balance_after_cents as bal from owa_ledger where abn=$1 and tax_type=$2 and period_id=$3 order by id desc limit 1',
        [abn, taxType, periodId]
      );
      newBalance = fallback.rows[0]?.bal ?? (previousBalance - amount);
    }

    await pool.query(
      "update periods set state='RELEASED' where id=$1",
      [period.id]
    );

    res.json({ released: true, bank_receipt_hash: syntheticReceipt, new_balance: newBalance });
  }));

  app.get('/evidence', asyncHandler(async (req, res) => {
    const { abn, taxType, periodId } = req.query;
    const periodResult = await pool.query(
      'select * from periods where abn=$1 and tax_type=$2 and period_id=$3',
      [abn, taxType, periodId]
    );
    if (periodResult.rowCount === 0) {
      return res.status(404).json({ error: 'NOT_FOUND' });
    }
    const period = periodResult.rows[0];

    const rptResult = await pool.query(
      'select payload, payload_c14n, payload_sha256, signature, created_at from rpt_tokens where abn=$1 and tax_type=$2 and period_id=$3 order by id desc limit 1',
      [abn, taxType, periodId]
    );
    const rpt = rptResult.rows[0] || null;

    const ledgerResult = await pool.query(
      'select id, amount_cents, balance_after_cents, bank_receipt_hash, prev_hash, hash_after, created_at from owa_ledger where abn=$1 and tax_type=$2 and period_id=$3 order by id',
      [abn, taxType, periodId]
    );

    const basLabels = { W1: null, W2: null, '1A': null, '1B': null };

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
        thresholds: period.thresholds
      },
      rpt,
      owa_ledger: ledgerResult.rows,
      bas_labels: basLabels,
      discrepancy_log: []
    });
  }));

  return app;
}

function startServer() {
  const pool = createPool();
  const app = createApp({ pool });
  const port = process.env.PORT ? Number(process.env.PORT) : 8080;
  const server = app.listen(port, () => {
    console.log(`APGMS demo API listening on :${port}`);
  });
  return { app, pool, server };
}

if (require.main === module) {
  startServer();
}

module.exports = { createApp, createPool, startServer };
