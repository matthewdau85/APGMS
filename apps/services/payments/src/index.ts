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

// Port (defaults to 3000)
const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;

// Prefer DATABASE_URL; else compose from PG* vars
const connectionString =
  process.env.DATABASE_URL ??
  `postgres://${process.env.PGUSER || 'apgms'}:${encodeURIComponent(process.env.PGPASSWORD || '')}` +
  `@${process.env.PGHOST || '127.0.0.1'}:${process.env.PGPORT || '5432'}/${process.env.PGDATABASE || 'apgms'}`;

// Export pool for other modules
const useFakePool = process.env.PAYMENTS_FAKE_POOL === '1';
const poolInstance = useFakePool
  ? new (await import('../../../../tests/helpers/fakeDb.js')).FakePool()
  : new Pool({ connectionString });

export const pool = poolInstance;

const app = express();
app.use(express.json());

// Health check
app.get('/health', (_req, res) => res.json({ ok: true }));

// Endpoints
app.post('/deposit', deposit);
app.post('/payAto', rptGate, payAtoRelease);
app.get('/balance', balance);
app.get('/ledger', ledger);

// 404 fallback
app.use((_req, res) => res.status(404).send('Not found'));

// Start server unless explicitly skipped (useful for tests)
if (process.env.PAYMENTS_SKIP_LISTEN !== '1') {
  app.listen(PORT, () => {
    console.log(`[payments] listening on http://localhost:${PORT}`);
  });
}

export { app };
