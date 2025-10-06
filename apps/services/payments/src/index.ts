// apps/services/payments/src/index.ts
import 'dotenv/config';
import './loadEnv.js'; // ensures .env.local is loaded when running with tsx

import express from 'express';
import pg from 'pg'; const { Pool } = pg;

import { rptGate } from './middleware/rptGate.js';
import { payAtoRelease } from './routes/payAto.js';
import { deposit } from './routes/deposit';
import { balance } from './routes/balance';
import { ledger } from './routes/ledger';
import { securityHeaders } from './middleware/securityHeaders.js';
import { corsAllowList } from './middleware/corsAllowList.js';
import { requireAuth, requireRole, requireMfa } from './middleware/auth.js';
import { createRateLimiter } from './middleware/rateLimit.js';
import { mfaActivate, mfaChallenge, mfaSetup } from './routes/auth/mfa.js';

// Port (defaults to 3000)
const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;

// Prefer DATABASE_URL; else compose from PG* vars
const connectionString =
  process.env.DATABASE_URL ??
  `postgres://${process.env.PGUSER || 'apgms'}:${encodeURIComponent(process.env.PGPASSWORD || '')}` +
  `@${process.env.PGHOST || '127.0.0.1'}:${process.env.PGPORT || '5432'}/${process.env.PGDATABASE || 'apgms'}`;

// Export pool for other modules
export const pool = new Pool({ connectionString });

const app = express();
app.use(express.json());
app.use(securityHeaders());
app.use(corsAllowList());

// Health check
app.get('/health', (_req, res) => res.json({ ok: true }));

app.use(requireAuth);

// MFA endpoints
app.post('/auth/mfa/setup', requireRole('viewer'), mfaSetup);
app.post('/auth/mfa/activate', requireRole('viewer'), mfaActivate);
app.post('/auth/mfa/challenge', requireRole('viewer'), mfaChallenge);

const depositLimiter = createRateLimiter({ windowMs: 60_000, max: 10 });
const releaseLimiter = createRateLimiter({ windowMs: 60_000, max: 5 });

// Endpoints
app.post('/deposit', requireRole('operator'), depositLimiter, deposit);
app.post('/payAto', requireRole('operator'), requireMfa, releaseLimiter, rptGate, payAtoRelease);
app.get('/balance', requireRole('viewer'), balance);
app.get('/ledger', requireRole('viewer'), ledger);

// 404 fallback
app.use((_req, res) => res.status(404).send('Not found'));

// Start server
app.listen(PORT, () => {
  console.log(`[payments] listening on http://localhost:${PORT}`);
});
