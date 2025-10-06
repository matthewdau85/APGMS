require('dotenv').config({ path: '.env.local' });
const express = require('express');
const bodyParser = require('body-parser');
const { Pool } = require('pg');
const nacl = require('tweetnacl');
const crypto = require('crypto');
const { TextEncoder } = require('util');

const logger = require('./lib/logger');
const { authenticate, requireMfa, issueToken, verifyPassword, verifyTotpForUser } = require('./lib/auth');
const { resolveSecret } = require('./lib/secrets');

const textEncoder = new TextEncoder();

const app = express();
app.use(logger.withRequestContext);
app.use(bodyParser.json({ limit: '1mb' }));
app.use((req, _res, next) => {
  logger.info('http.request', { method: req.method, path: req.originalUrl || req.url });
  next();
});

const {
  PGHOST = '127.0.0.1',
  PGUSER = 'apgms',
  PGPASSWORD = 'apgms_pw',
  PGDATABASE = 'apgms',
  PGPORT = '5432',
  ATO_PRN = '1234567890',
  RELEASE_SECOND_APPROVER_LIMIT_CENTS = '1000000'
} = process.env;

const pool = new Pool({
  host: PGHOST,
  user: PGUSER,
  password: PGPASSWORD,
  database: PGDATABASE,
  port: +PGPORT
});

const releaseLimit = Number(RELEASE_SECOND_APPROVER_LIMIT_CENTS || '0');

let rptSecretPromise;
function getRptSecret() {
  if (!rptSecretPromise) {
    rptSecretPromise = resolveSecret('RPT_ED25519_SECRET_BASE64', 'RPT_ED25519_SECRET_BASE64');
  }
  return rptSecretPromise;
}

function respondWithError(res, err) {
  const pgProtocolError = err && err.code === '08P01';
  const status = err.statusCode || (pgProtocolError ? 500 : 400);
  logger.error('request.error', {
    message: err.message,
    code: err.code,
    stack: process.env.NODE_ENV === 'production' ? undefined : err.stack
  });
  if (pgProtocolError || status >= 500) {
    return res.status(500).json({ error: 'INTERNAL' });
  }
  const errorCode = err.publicCode || err.code || err.message || 'BAD_REQUEST';
  return res.status(status).json({ error: errorCode });
}

const ah = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (err) {
    respondWithError(res, err);
  }
};

app.get('/health', ah(async (_req, res) => {
  await pool.query('SELECT now()');
  res.json({ status: 'ok' });
}));

app.post('/auth/login', ah(async (req, res) => {
  const { email, password, otp } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'INVALID_CREDENTIALS' });
  }
  const userResult = await pool.query(
    'SELECT id, email, password_hash, role, totp_secret, mfa_enabled FROM users WHERE email = $1',
    [email]
  );
  if (userResult.rowCount === 0) {
    return res.status(401).json({ error: 'INVALID_CREDENTIALS' });
  }
  const user = userResult.rows[0];
  const passwordValid = await verifyPassword(password, user.password_hash);
  if (!passwordValid) {
    return res.status(401).json({ error: 'INVALID_CREDENTIALS' });
  }
  logger.setActor(user.email);
  let mfaSatisfied = !user.mfa_enabled;
  if (user.mfa_enabled) {
    if (otp) {
      const validOtp = await verifyTotpForUser(user, otp);
      if (!validOtp) {
        return res.status(401).json({ error: 'INVALID_OTP' });
      }
      mfaSatisfied = true;
    }
  }
  const token = await issueToken(user, { mfa: mfaSatisfied });
  res.json({ token, mfaRequired: Boolean(user.mfa_enabled && !mfaSatisfied) });
}));

app.post('/auth/mfa/totp', authenticate, ah(async (req, res) => {
  const { code } = req.body || {};
  if (!code) {
    return res.status(400).json({ error: 'OTP_REQUIRED' });
  }
  const userResult = await pool.query(
    'SELECT id, email, role, totp_secret, mfa_enabled FROM users WHERE id = $1',
    [req.user.sub]
  );
  if (userResult.rowCount === 0) {
    return res.status(404).json({ error: 'USER_NOT_FOUND' });
  }
  const user = userResult.rows[0];
  if (!user.mfa_enabled) {
    return res.status(400).json({ error: 'MFA_NOT_ENABLED' });
  }
  const validOtp = await verifyTotpForUser(user, code);
  if (!validOtp) {
    return res.status(401).json({ error: 'INVALID_OTP' });
  }
  logger.setActor(user.email);
  const token = await issueToken(user, { mfa: true });
  res.json({ token });
}));

app.post('/approvals/release', authenticate, requireMfa, ah(async (req, res) => {
  const { abn, taxType, periodId, decision, reason } = req.body || {};
  if (!abn || !taxType || !periodId || !decision) {
    return res.status(400).json({ error: 'INVALID_REQUEST' });
  }
  const normalizedDecision = String(decision).trim().toUpperCase();
  if (!['APPROVED', 'REJECTED'].includes(normalizedDecision)) {
    return res.status(400).json({ error: 'INVALID_DECISION' });
  }
  const periodResult = await pool.query(
    'SELECT id, final_liability_cents FROM periods WHERE abn = $1 AND tax_type = $2 AND period_id = $3',
    [abn, taxType, periodId]
  );
  if (periodResult.rowCount === 0) {
    return res.status(404).json({ error: 'PERIOD_NOT_FOUND' });
  }
  const amount = Number(periodResult.rows[0].final_liability_cents || 0);
  const actor = req.user.email || req.user.sub;
  await pool.query(
    `INSERT INTO release_approvals (abn, tax_type, period_id, amount_cents, actor, request_id, decision, reason)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (abn, tax_type, period_id, actor)
     DO UPDATE SET decision = EXCLUDED.decision, reason = EXCLUDED.reason, amount_cents = EXCLUDED.amount_cents,
                   request_id = EXCLUDED.request_id, created_at = NOW(), consumed_at = NULL`,
    [abn, taxType, periodId, amount, actor, req.requestId, normalizedDecision, reason || null]
  );
  logger.info('release.approval.recorded', { abn, taxType, periodId, decision: normalizedDecision });
  res.json({ recorded: true, decision: normalizedDecision });
}));

app.get('/period/status', ah(async (req, res) => {
  const { abn, taxType, periodId } = req.query;
  const result = await pool.query(
    'SELECT * FROM periods WHERE abn = $1 AND tax_type = $2 AND period_id = $3',
    [abn, taxType, periodId]
  );
  if (result.rowCount === 0) {
    return res.status(404).json({ error: 'NOT_FOUND' });
  }
  res.json({ period: result.rows[0] });
}));

app.post('/rpt/issue', authenticate, requireMfa, ah(async (req, res) => {
  const { abn, taxType, periodId } = req.body || {};
  const periodResult = await pool.query(
    'SELECT * FROM periods WHERE abn = $1 AND tax_type = $2 AND period_id = $3',
    [abn, taxType, periodId]
  );
  if (periodResult.rowCount === 0) {
    const err = new Error('PERIOD_NOT_FOUND');
    err.publicCode = 'PERIOD_NOT_FOUND';
    throw err;
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
  const exceeds =
    Number(anomalyVector.variance_ratio || 0) > thresholds.variance_ratio ||
    Number(anomalyVector.dup_rate || 0) > thresholds.dup_rate ||
    Number(anomalyVector.gap_minutes || 0) > thresholds.gap_minutes ||
    Math.abs(Number(anomalyVector.delta_vs_baseline || 0)) > thresholds.delta_vs_baseline;
  if (exceeds) {
    await pool.query('UPDATE periods SET state = $1 WHERE id = $2', ['BLOCKED_ANOMALY', period.id]);
    return res.status(409).json({ error: 'BLOCKED_ANOMALY' });
  }

  const epsilon = Math.abs(Number(period.final_liability_cents) - Number(period.credited_to_owa_cents));
  if (epsilon > thresholds.epsilon_cents) {
    await pool.query('UPDATE periods SET state = $1 WHERE id = $2', ['BLOCKED_DISCREPANCY', period.id]);
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
    reference: ATO_PRN,
    expiry_ts: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    nonce: crypto.randomUUID()
  };
  const payloadStr = JSON.stringify(payload);
  const payloadSha256 = crypto.createHash('sha256').update(payloadStr).digest('hex');
  const msg = textEncoder.encode(payloadStr);
  const secretBase64 = await getRptSecret();
  if (!secretBase64) {
    throw new Error('NO_RPT_SECRET');
  }
  const secretKey = Buffer.from(secretBase64, 'base64');
  const signature = Buffer.from(nacl.sign.detached(msg, new Uint8Array(secretKey))).toString('base64');

  await pool.query(
    `INSERT INTO rpt_tokens(abn, tax_type, period_id, payload, signature, payload_c14n, payload_sha256)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [abn, taxType, periodId, payload, signature, payloadStr, payloadSha256]
  );
  await pool.query('UPDATE periods SET state = $1 WHERE id = $2', ['READY_RPT', period.id]);
  res.json({ payload, signature, payload_sha256: payloadSha256 });
}));

app.post('/release', authenticate, requireMfa, ah(async (req, res) => {
  const { abn, taxType, periodId } = req.body || {};
  const periodResult = await pool.query(
    'SELECT * FROM periods WHERE abn = $1 AND tax_type = $2 AND period_id = $3',
    [abn, taxType, periodId]
  );
  if (periodResult.rowCount === 0) {
    throw new Error('PERIOD_NOT_FOUND');
  }
  const period = periodResult.rows[0];

  const rptToken = await pool.query(
    `SELECT payload, signature FROM rpt_tokens
     WHERE abn = $1 AND tax_type = $2 AND period_id = $3
     ORDER BY id DESC LIMIT 1`,
    [abn, taxType, periodId]
  );
  if (rptToken.rowCount === 0) {
    return res.status(400).json({ error: 'NO_RPT' });
  }

  const ledgerResult = await pool.query(
    `SELECT balance_after_cents FROM owa_ledger
      WHERE abn = $1 AND tax_type = $2 AND period_id = $3
      ORDER BY id DESC LIMIT 1`,
    [abn, taxType, periodId]
  );
  const previousBalance = Number(ledgerResult.rows[0]?.balance_after_cents || 0);
  const amount = Number(period.final_liability_cents || 0);
  if (previousBalance < amount) {
    return res.status(422).json({
      error: 'INSUFFICIENT_OWA',
      prevBal: String(previousBalance),
      needed: amount
    });
  }

  let approvalsToConsume = [];
  if (releaseLimit > 0 && amount > releaseLimit) {
    const approvals = await pool.query(
      `SELECT id, actor FROM release_approvals
        WHERE abn = $1 AND tax_type = $2 AND period_id = $3
          AND decision = 'APPROVED' AND consumed_at IS NULL`,
      [abn, taxType, periodId]
    );
    const unique = new Map();
    for (const row of approvals.rows) {
      if (!unique.has(row.actor)) {
        unique.set(row.actor, row.id);
      }
    }
    if (unique.size < 2) {
      return res.status(403).json({
        error: 'APPROVALS_REQUIRED',
        required: 2,
        have: unique.size
      });
    }
    approvalsToConsume = Array.from(unique.values());
  }

  const synthetic = 'rpt_debit:' + crypto.randomUUID().slice(0, 12);
  const releaseResult = await pool.query(
    'SELECT * FROM owa_append($1, $2, $3, $4, $5)',
    [abn, taxType, periodId, -amount, synthetic]
  );

  let newBalance = null;
  if (releaseResult.rowCount && releaseResult.rows[0] && releaseResult.rows[0].out_balance_after != null) {
    newBalance = releaseResult.rows[0].out_balance_after;
  } else {
    const fallback = await pool.query(
      `SELECT balance_after_cents AS bal FROM owa_ledger
        WHERE abn = $1 AND tax_type = $2 AND period_id = $3
        ORDER BY id DESC LIMIT 1`,
      [abn, taxType, periodId]
    );
    newBalance = fallback.rows[0]?.bal ?? (previousBalance - amount);
  }

  await pool.query('UPDATE periods SET state = $1 WHERE id = $2', ['RELEASED', period.id]);
  if (approvalsToConsume.length) {
    await pool.query(
      'UPDATE release_approvals SET consumed_at = NOW() WHERE id = ANY($1::bigint[])',
      [approvalsToConsume]
    );
  }
  logger.info('release.completed', { abn, taxType, periodId, amount, newBalance });
  res.json({ released: true, bank_receipt_hash: synthetic, new_balance: newBalance });
}));

app.get('/evidence', authenticate, requireMfa, ah(async (req, res) => {
  const { abn, taxType, periodId } = req.query;
  const periodResult = await pool.query(
    'SELECT * FROM periods WHERE abn = $1 AND tax_type = $2 AND period_id = $3',
    [abn, taxType, periodId]
  );
  if (periodResult.rowCount === 0) {
    return res.status(404).json({ error: 'NOT_FOUND' });
  }
  const period = periodResult.rows[0];

  const rptResult = await pool.query(
    `SELECT payload, payload_c14n, payload_sha256, signature, created_at
       FROM rpt_tokens
      WHERE abn = $1 AND tax_type = $2 AND period_id = $3
      ORDER BY id DESC LIMIT 1`,
    [abn, taxType, periodId]
  );
  const rpt = rptResult.rows[0] || null;

  const ledger = await pool.query(
    `SELECT id, amount_cents, balance_after_cents, bank_receipt_hash, prev_hash, hash_after, created_at
       FROM owa_ledger
      WHERE abn = $1 AND tax_type = $2 AND period_id = $3
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
    owa_ledger: ledger.rows,
    bas_labels: basLabels,
    discrepancy_log: []
  });
}));

const port = process.env.PORT ? +process.env.PORT : 8080;
app.listen(port, () => logger.info('server.started', { port }));
