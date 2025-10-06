// apps/services/payments/src/index.ts
import 'dotenv/config';
import './loadEnv.js'; // ensures .env.local is loaded when running with tsx

import express from 'express';
import pg from 'pg'; const { Pool } = pg;

import {
  createLogger,
  requestLogger,
  securityHeaders,
  corsMiddleware,
  rateLimiter,
} from '../../../../libs/security/index.js';
import { authenticate, ensureRealModeTotp, getAppMode, requireDualApproval, requireRoles, requireTotp, setAppMode } from './middleware/auth.js';
import { rptGate } from './middleware/rptGate.js';
import { payAtoRelease } from './routes/payAto.js';
import { deposit } from './routes/deposit';
import { balance } from './routes/balance';
import { ledger } from './routes/ledger';

// Port (defaults to 3000)
const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;

// Prefer DATABASE_URL; else compose from PG* vars
const connectionString =
  process.env.DATABASE_URL ??
  `postgres://${process.env.PGUSER || 'apgms'}:${encodeURIComponent(process.env.PGPASSWORD || '')}` +
  `@${process.env.PGHOST || '127.0.0.1'}:${process.env.PGPORT || '5432'}/${process.env.PGDATABASE || 'apgms'}`;

// Export pool for other modules
export const pool = new Pool({ connectionString });

export const app = express();
const logger = createLogger({ bindings: { service: 'payments' } });

app.use(express.json());
app.use(securityHeaders());
app.use(corsMiddleware({ origins: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : ['*'] }));
app.use(rateLimiter({ limit: Number(process.env.RATE_LIMIT_MAX || 120) }));
app.use(requestLogger(logger));

// Health check
app.get('/health', (_req, res) => res.json({ ok: true }));

app.get('/mode', (_req, res) => res.json({ mode: getAppMode() }));
app.post('/mode', authenticate, requireRoles('admin'), requireTotp, (req, res) => {
  const mode = String(req.body?.mode || '').toLowerCase();
  if (mode !== 'test' && mode !== 'real') {
    return res.status(400).json({ error: 'INVALID_MODE' });
  }
  setAppMode(mode as 'test' | 'real');
  return res.json({ mode: getAppMode() });
});

// Endpoints
app.post('/deposit', authenticate, requireRoles('admin', 'accountant'), deposit);
app.post('/payAto', authenticate, requireRoles('admin', 'accountant'), ensureRealModeTotp, rptGate, (req, res) => {
  try {
    requireDualApproval(req, Math.abs(Number(req.body?.amountCents || 0)));
  } catch (err: any) {
    return res.status(403).json({ error: err?.message || 'DUAL_APPROVAL_FAILED' });
  }
  return payAtoRelease(req, res);
});
app.get('/balance', authenticate, requireRoles('admin', 'accountant', 'auditor'), balance);
app.get('/ledger', authenticate, requireRoles('admin', 'accountant', 'auditor'), ledger);

// 404 fallback
app.use((_req, res) => res.status(404).send('Not found'));

if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    logger.info({ event: 'startup', port: PORT }, '[payments] listening');
  });
}
