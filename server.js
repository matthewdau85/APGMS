require('dotenv').config({ path: '.env.local' });
const express = require('express');
const bodyParser = require('body-parser');
const { Pool } = require('pg');
const nacl = require('tweetnacl');
const crypto = require('crypto');

const textEncoder = new TextEncoder();

const {
  PGHOST = '127.0.0.1',
  PGUSER = 'apgms',
  PGPASSWORD = 'apgms_pw',
  PGDATABASE = 'apgms',
  PGPORT = '5432'
} = process.env;

const defaultPool = () => new Pool({
  host: PGHOST,
  user: PGUSER,
  password: PGPASSWORD,
  database: PGDATABASE,
  port: Number(PGPORT)
});

const wrapHandler = (pool, env) => fn => async (req, res) => {
  try {
    await fn(req, res, pool, env);
  } catch (e) {
    console.error(e);
    if (e && e.code === '08P01') {
      return res.status(500).json({ error: 'INTERNAL', message: e.message });
    }
    res.status(400).json({ error: e.message || 'BAD_REQUEST' });
  }
};

function buildApp(pool = defaultPool(), env = process.env) {
  const {
    RPT_ED25519_SECRET_BASE64,
    ATO_PRN = '1234567890'
  } = env;

  const app = express();
  app.use(bodyParser.json());

  const ah = wrapHandler(pool, env);

  // ---------- HEALTH ----------
  app.get('/health', ah(async (req, res, db) => {
    await db.query('SELECT now()');
    res.json(['ok', 'db', true, 'up']);
  }));

  const findPeriod = async (db, abn, taxType, periodId) => {
    const result = await db.query(
      'SELECT * FROM periods WHERE abn=$1 AND tax_type=$2 AND period_id=$3',
      [abn, taxType, periodId]
    );
    return result.rows[0] || null;
  };

  const updatePeriodState = async (db, periodId, state) => {
    const result = await db.query(
      'UPDATE periods SET state=$1 WHERE id=$2 RETURNING *',
      [state, periodId]
    );
    if (result.rowCount === 0) {
      throw new Error('PERIOD_UPDATE_FAILED');
    }
    return result.rows[0];
  };

  // ---------- PERIOD STATUS ----------
  app.get('/period/status', ah(async (req, res, db) => {
    const { abn, taxType, periodId } = req.query;
    const period = await findPeriod(db, abn, taxType, periodId);
    if (!period) {
      return res.status(404).json({ error: 'NOT_FOUND' });
    }
    res.json({ period });
  }));

  // ---------- RPT ISSUE ----------
  app.post('/rpt/issue', ah(async (req, res, db) => {
    const { abn, taxType, periodId } = req.body;
    const period = await findPeriod(db, abn, taxType, periodId);
    if (!period) {
      throw new Error('PERIOD_NOT_FOUND');
    }

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

    const v = period.anomaly_vector || {};
    const exceeds =
      (v.variance_ratio || 0) > thresholds.variance_ratio ||
      (v.dup_rate || 0) > thresholds.dup_rate ||
      (v.gap_minutes || 0) > thresholds.gap_minutes ||
      Math.abs(v.delta_vs_baseline || 0) > thresholds.delta_vs_baseline;

    if (exceeds) {
      await updatePeriodState(db, period.id, 'BLOCKED_ANOMALY');
      return res.status(409).json({ error: 'BLOCKED_ANOMALY' });
    }

    const epsilon = Math.abs(Number(period.final_liability_cents) - Number(period.credited_to_owa_cents));
    if (epsilon > thresholds.epsilon_cents) {
      await updatePeriodState(db, period.id, 'BLOCKED_DISCREPANCY');
      return res.status(409).json({ error: 'BLOCKED_DISCREPANCY', epsilon });
    }

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
      anomaly_vector: v,
      thresholds,
      rail_id: 'EFT',
      reference: ATO_PRN,
      expiry_ts: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      nonce: crypto.randomUUID()
    };

    const payloadStr = JSON.stringify(payload);
    const payloadSha256 = crypto.createHash('sha256').update(payloadStr).digest('hex');
    const msg = textEncoder.encode(payloadStr);

    const skBuf = Buffer.from(RPT_ED25519_SECRET_BASE64, 'base64');
    const sig = nacl.sign.detached(msg, new Uint8Array(skBuf));
    const signature = Buffer.from(sig).toString('base64');

    const insertToken = await db.query(
      `INSERT INTO rpt_tokens (abn, tax_type, period_id, payload, signature, payload_c14n, payload_sha256)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7)
       RETURNING id, abn, tax_type, period_id, payload, signature, payload_c14n, payload_sha256, created_at`,
      [abn, taxType, periodId, payloadStr, signature, payloadStr, payloadSha256]
    );

    if (insertToken.rowCount === 0) {
      throw new Error('RPT_INSERT_FAILED');
    }

    await updatePeriodState(db, period.id, 'READY_RPT');

    res.json({
      payload,
      signature,
      payload_sha256: payloadSha256,
      token: insertToken.rows[0]
    });
  }));

  // ---------- RELEASE (debit from OWA; uses owa_append OUT cols) ----------
  app.post('/release', ah(async (req, res, db) => {
    const { abn, taxType, periodId } = req.body;

    const period = await findPeriod(db, abn, taxType, periodId);
    if (!period) {
      throw new Error('PERIOD_NOT_FOUND');
    }

    const rptResult = await db.query(
      `SELECT payload, signature FROM rpt_tokens
       WHERE abn=$1 AND tax_type=$2 AND period_id=$3
       ORDER BY id DESC LIMIT 1`,
      [abn, taxType, periodId]
    );
    if (rptResult.rowCount === 0) {
      return res.status(400).json({ error: 'NO_RPT' });
    }

    const ledgerResult = await db.query(
      `SELECT balance_after_cents FROM owa_ledger
       WHERE abn=$1 AND tax_type=$2 AND period_id=$3
       ORDER BY id DESC LIMIT 1`,
      [abn, taxType, periodId]
    );

    const prevBal = ledgerResult.rows[0]?.balance_after_cents ?? 0;
    const amt = Number(period.final_liability_cents);
    if (prevBal < amt) {
      return res.status(422).json({
        error: 'INSUFFICIENT_OWA',
        prevBal: String(prevBal),
        needed: amt
      });
    }

    const synthetic = 'rpt_debit:' + crypto.randomUUID().slice(0, 12);
    const debitResult = await db.query(
      'SELECT * FROM owa_append($1, $2, $3, $4, $5)',
      [abn, taxType, periodId, -amt, synthetic]
    );

    let newBalance = null;
    if (debitResult.rowCount && debitResult.rows[0] && debitResult.rows[0].balance_after != null) {
      newBalance = Number(debitResult.rows[0].balance_after);
    }

    if (newBalance === null) {
      const fallback = await db.query(
        `SELECT balance_after_cents AS bal FROM owa_ledger
         WHERE abn=$1 AND tax_type=$2 AND period_id=$3
         ORDER BY id DESC LIMIT 1`,
        [abn, taxType, periodId]
      );
      newBalance = fallback.rows[0]?.bal ?? (prevBal - amt);
    }

    await updatePeriodState(db, period.id, 'RELEASED');

    res.json({ released: true, bank_receipt_hash: synthetic, new_balance: newBalance });
  }));

  // ---------- EVIDENCE ----------
  app.get('/evidence', ah(async (req, res, db) => {
    const { abn, taxType, periodId } = req.query;
    const period = await findPeriod(db, abn, taxType, periodId);
    if (!period) {
      return res.status(404).json({ error: 'NOT_FOUND' });
    }

    const rptResult = await db.query(
      `SELECT payload, payload_c14n, payload_sha256, signature, created_at
       FROM rpt_tokens
       WHERE abn=$1 AND tax_type=$2 AND period_id=$3
       ORDER BY id DESC LIMIT 1`,
      [abn, taxType, periodId]
    );
    const rpt = rptResult.rows[0] || null;

    const ledgerResult = await db.query(
      `SELECT id, amount_cents, balance_after_cents, bank_receipt_hash, prev_hash, hash_after, created_at
       FROM owa_ledger
       WHERE abn=$1 AND tax_type=$2 AND period_id=$3
       ORDER BY id`,
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

if (require.main === module) {
  const pool = defaultPool();
  const port = process.env.PORT ? Number(process.env.PORT) : 8080;
  const app = buildApp(pool, process.env);
  const server = app.listen(port, () => console.log(`APGMS demo API listening on :${port}`));

  process.on('SIGINT', async () => {
    server.close();
    await pool.end();
    process.exit(0);
  });
}

module.exports = { buildApp, defaultPool };
