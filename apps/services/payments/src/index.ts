// apps/services/payments/src/index.ts
import 'dotenv/config';
import './loadEnv.js'; // ensures .env.local is loaded when running with tsx

import express from 'express';
import pg from 'pg'; const { Pool } = pg;
import { fileURLToPath } from 'node:url';

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

export function createPaymentsRouter() {
  const router = express.Router();
  router.use(express.json());

  router.post('/deposit', deposit);
  router.post('/payAto', rptGate, payAtoRelease);
  router.get('/balance', balance);
  router.get('/ledger', ledger);

  return router;
}

export function createPaymentsApp() {
  const app = express();

  app.get('/health', (_req, res) => res.json({ ok: true }));
  app.use(createPaymentsRouter());
  app.use((_req, res) => res.status(404).send('Not found'));

  return app;
}

const app = createPaymentsApp();

const isMainModule = process.argv[1] === fileURLToPath(import.meta.url);

if (isMainModule) {
  app.listen(PORT, () => {
    console.log(`[payments] listening on http://localhost:${PORT}`);
  });
}
