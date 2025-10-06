require('dotenv').config({ path: '.env.local' });

const crypto = require('crypto');
const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const nacl = require('tweetnacl');
const {
  createLogger,
  requestLogger,
  securityHeaders,
  corsMiddleware,
  rateLimiter,
  verifyJwt,
  checkTotp,
} = require('./libs/security');

const manifestPath = path.join(__dirname, 'apps/services/tax-engine/app/rules/manifest.json');
const taxManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
const RATES_VERSION = taxManifest.version;
const RULES_MANIFEST_SHA256 = taxManifest.composite_sha256;

const {
  PGHOST = '127.0.0.1',
  PGUSER = 'apgms',
  PGPASSWORD = 'apgms_pw',
  PGDATABASE = 'apgms',
  PGPORT = '5432',
  RPT_ED25519_SECRET_BASE64,
  ATO_PRN = '1234567890',
  JWT_SECRET = 'dev-secret',
  TOTP_SECRET,
  APP_MODE: APP_MODE_ENV = 'test',
  RATE_LIMIT_MAX = '120',
  DUAL_APPROVAL_THRESHOLD_CENTS = '25000000',
} = process.env;

let appMode = APP_MODE_ENV;

const pool = new Pool({
  host: PGHOST,
  user: PGUSER,
  password: PGPASSWORD,
  database: PGDATABASE,
  port: Number(PGPORT),
});

const logger = createLogger({ bindings: { service: 'server' } });

const app = express();
app.use(bodyParser.json());
app.use(securityHeaders());
app.use(corsMiddleware({ origins: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : ['*'] }));
app.use(rateLimiter({ limit: Number(RATE_LIMIT_MAX) }));
app.use(requestLogger(logger));

const RELEASE_ROLES = new Set(['admin', 'accountant']);

function authenticate(req, res, next) {
  const header = req.headers['authorization'];
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'AUTH_REQUIRED' });
  }
  const token = header.slice(7);
  try {
    const payload = verifyJwt(token, JWT_SECRET);
    const roles = Array.isArray(payload.roles) ? payload.roles.map(String) : [];
    req.user = {
      sub: payload.sub || payload.user_id || payload.email || 'unknown',
      roles,
      mfa: Boolean(payload.mfa),
    };
    req.auth = req.user;
    return next();
  } catch (err) {
    return res.status(401).json({ error: 'INVALID_TOKEN' });
  }
}

function requireRoles(...roles) {
  return (req, res, next) => {
    const userRoles = (req.user?.roles || []).map((r) => String(r).toLowerCase());
    const ok = roles.some((r) => userRoles.includes(r.toLowerCase()));
    if (!ok) return res.status(403).json({ error: 'INSUFFICIENT_ROLE' });
    return next();
  };
}

function requireTotp(req, res, next) {
  if (!TOTP_SECRET) {
    return res.status(500).json({ error: 'MFA_NOT_CONFIGURED' });
  }
  const token = (req.headers['x-totp'] || req.body?.totp || '').toString();
  if (!token || !checkTotp(token, TOTP_SECRET)) {
    return res.status(401).json({ error: 'MFA_REQUIRED' });
  }
  return next();
}

function ensureRealModeTotp(req, res, next) {
  if (appMode === 'real') {
    return requireTotp(req, res, next);
  }
  return next();
}

function withAsync(fn) {
  return (req, res) =>
    Promise.resolve(fn(req, res)).catch((err) => {
      req.log.error({ err }, 'request failed');
      if (err.code === '08P01') return res.status(500).json({ error: 'INTERNAL', message: err.message });
      return res.status(400).json({ error: err.message || 'BAD_REQUEST' });
    });
}

async function validateDualApproval(req, amount) {
  const threshold = Number(DUAL_APPROVAL_THRESHOLD_CENTS);
  if (!Number.isFinite(threshold) || Math.abs(amount) < threshold) return null;

  const token = req.body?.coSignerToken;
  if (!token) {
    throw new Error('DUAL_APPROVAL_REQUIRED');
  }
  let payload;
  try {
    payload = verifyJwt(token, JWT_SECRET);
  } catch (err) {
    throw new Error('DUAL_APPROVAL_INVALID');
  }
  const roles = Array.isArray(payload.roles) ? payload.roles : [];
  const ok = roles.some((r) => RELEASE_ROLES.has(String(r).toLowerCase()));
  if (!ok) {
    throw new Error('DUAL_APPROVAL_FORBIDDEN');
  }
  const coSub = payload.sub || payload.user_id || payload.email;
  if (!coSub || (req.user && coSub === req.user.sub)) {
    throw new Error('DUAL_APPROVAL_DISTINCT');
  }
  return { sub: coSub, roles };
}

// ---------- HEALTH ----------
app.get(
  '/health',
  withAsync(async (_req, res) => {
    await pool.query('select now()');
    res.json(['ok', 'db', true, 'up']);
  }),
);

// ---------- APP MODE ----------
app.get('/app-mode', (_req, res) => {
  res.json({ mode: appMode });
});

app.post('/app-mode', authenticate, requireRoles('admin'), requireTotp, (req, res) => {
  const nextMode = String(req.body?.mode || '').toLowerCase();
  if (!['test', 'real'].includes(nextMode)) {
    return res.status(400).json({ error: 'INVALID_MODE' });
  }
  appMode = nextMode;
  return res.json({ mode: appMode });
});

// ---------- PERIOD STATUS ----------
app.get(
  '/period/status',
  withAsync(async (req, res) => {
    const { abn, taxType, periodId } = req.query;
    const query =
      'select * from periods where abn=$1 and tax_type=$2 and period_id=$3 limit 1';
    const result = await pool.query(query, [abn, taxType, periodId]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'NOT_FOUND' });
    return res.json({ period: result.rows[0] });
  }),
);

// ---------- RPT ISSUE ----------
app.post(
  '/rpt/issue',
  authenticate,
  requireRoles('admin', 'accountant'),
  withAsync(async (req, res) => {
    const { abn, taxType, periodId } = req.body;
    const periodSql =
      'select * from periods where abn=$1 and tax_type=$2 and period_id=$3 limit 1';
    const periodResult = await pool.query(periodSql, [abn, taxType, periodId]);
    if (periodResult.rowCount === 0) throw new Error('PERIOD_NOT_FOUND');
    const period = periodResult.rows[0];

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
      (anomalyVector.variance_ratio || 0) > thresholds.variance_ratio ||
      (anomalyVector.dup_rate || 0) > thresholds.dup_rate ||
      (anomalyVector.gap_minutes || 0) > thresholds.gap_minutes ||
      Math.abs(anomalyVector.delta_vs_baseline || 0) > thresholds.delta_vs_baseline;

    if (exceeds) {
      await pool.query('update periods set state=$1 where id=$2', ['BLOCKED_ANOMALY', period.id]);
      return res.status(409).json({ error: 'BLOCKED_ANOMALY' });
    }

    const epsilon = Math.abs(Number(period.final_liability_cents) - Number(period.credited_to_owa_cents));
    if (epsilon > thresholds.epsilon_cents) {
      await pool.query('update periods set state=$1 where id=$2', ['BLOCKED_DISCREPANCY', period.id]);
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
      nonce: crypto.randomUUID(),
      rates_version: RATES_VERSION,
      rules_manifest_sha256: RULES_MANIFEST_SHA256,
    };

    const payloadStr = JSON.stringify(payload);
    const payloadSha256 = crypto.createHash('sha256').update(payloadStr).digest('hex');
    const encoder = new TextEncoder();
    const msg = encoder.encode(payloadStr);

    if (!RPT_ED25519_SECRET_BASE64) throw new Error('NO_SK');
    const skBuf = Buffer.from(RPT_ED25519_SECRET_BASE64, 'base64');
    const sig = nacl.sign.detached(msg, new Uint8Array(skBuf));
    const signature = Buffer.from(sig).toString('base64');

    await pool.query(
      'insert into rpt_tokens(abn,tax_type,period_id,payload,signature,payload_c14n,payload_sha256) values ($1,$2,$3,$4,$5,$6,$7)',
      [abn, taxType, periodId, payloadStr, signature, payloadStr, payloadSha256],
    );

    await pool.query('update periods set state=$1 where id=$2', ['READY_RPT', period.id]);
    res.json({ payload, signature, payload_sha256: payloadSha256 });
  }),
);

// ---------- RELEASE ----------
app.post(
  '/release',
  authenticate,
  requireRoles(...RELEASE_ROLES),
  ensureRealModeTotp,
  withAsync(async (req, res) => {
    const { abn, taxType, periodId } = req.body;

    const periodSql =
      'select * from periods where abn=$1 and tax_type=$2 and period_id=$3 limit 1';
    const periodResult = await pool.query(periodSql, [abn, taxType, periodId]);
    if (periodResult.rowCount === 0) throw new Error('PERIOD_NOT_FOUND');
    const period = periodResult.rows[0];

    const tokenSql =
      'select payload, signature from rpt_tokens where abn=$1 and tax_type=$2 and period_id=$3 order by id desc limit 1';
    const tokenResult = await pool.query(tokenSql, [abn, taxType, periodId]);
    if (tokenResult.rowCount === 0) return res.status(400).json({ error: 'NO_RPT' });

    const balanceSql =
      'select balance_after_cents from owa_ledger where abn=$1 and tax_type=$2 and period_id=$3 order by id desc limit 1';
    const balanceResult = await pool.query(balanceSql, [abn, taxType, periodId]);
    const prevBal = balanceResult.rows[0]?.balance_after_cents ? Number(balanceResult.rows[0].balance_after_cents) : 0;

    const amount = Number(period.final_liability_cents);
    if (prevBal < amount) {
      return res.status(422).json({ error: 'INSUFFICIENT_OWA', prevBal: String(prevBal), needed: amount });
    }

    await validateDualApproval(req, amount * -1);

    const synthetic = `rpt_debit:${crypto.randomUUID().slice(0, 12)}`;
    const appendSql = 'select * from owa_append($1,$2,$3,$4,$5)';
    const appendResult = await pool.query(appendSql, [abn, taxType, periodId, -amount, synthetic]);

    let newBalance = null;
    if (appendResult.rowCount && appendResult.rows[0]?.out_balance_after != null) {
      newBalance = appendResult.rows[0].out_balance_after;
    } else {
      const fallback = await pool.query(
        'select balance_after_cents as bal from owa_ledger where abn=$1 and tax_type=$2 and period_id=$3 order by id desc limit 1',
        [abn, taxType, periodId],
      );
      newBalance = fallback.rows[0]?.bal ?? prevBal - amount;
    }

    await pool.query('update periods set state=$1 where id=$2', ['RELEASED', period.id]);
    res.json({ released: true, bank_receipt_hash: synthetic, new_balance: newBalance });
  }),
);

// ---------- EVIDENCE ----------
app.get(
  '/evidence',
  authenticate,
  requireRoles('admin', 'accountant', 'auditor'),
  withAsync(async (req, res) => {
    const { abn, taxType, periodId } = req.query;
    const periodSql =
      'select * from periods where abn=$1 and tax_type=$2 and period_id=$3 limit 1';
    const periodResult = await pool.query(periodSql, [abn, taxType, periodId]);
    if (periodResult.rowCount === 0) return res.status(404).json({ error: 'NOT_FOUND' });
    const period = periodResult.rows[0];

    const rptSql =
      'select payload, payload_c14n, payload_sha256, signature, created_at from rpt_tokens where abn=$1 and tax_type=$2 and period_id=$3 order by id desc limit 1';
    const rptResult = await pool.query(rptSql, [abn, taxType, periodId]);
    const rpt = rptResult.rows[0] || null;

    const ledgerSql =
      'select id, amount_cents, balance_after_cents, bank_receipt_hash, prev_hash, hash_after, created_at from owa_ledger where abn=$1 and tax_type=$2 and period_id=$3 order by id';
    const ledgerResult = await pool.query(ledgerSql, [abn, taxType, periodId]);

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
        thresholds: period.thresholds,
      },
      rpt,
      owa_ledger: ledgerResult.rows,
      bas_labels: basLabels,
      discrepancy_log: [],
    });
  }),
);

const port = process.env.PORT ? Number(process.env.PORT) : 8080;
app.listen(port, () => {
  logger.info(`APGMS demo API listening on :${port} (${appMode})`);
});
