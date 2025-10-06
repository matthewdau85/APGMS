// apps/services/payments/src/index.ts
import 'dotenv/config';
import './loadEnv.js';

import express from 'express';
import pg from 'pg';
import { rptGate } from './middleware/rptGate.js';
import { payAtoRelease } from './routes/payAto.js';
import { deposit } from './routes/deposit';
import { balance } from './routes/balance';
import { ledger } from './routes/ledger';
import { AddressInfo } from 'net';
import { once } from 'events';
import { fileURLToPath } from 'url';
import path from 'path';

const { Pool } = pg;

const connectionString =
  process.env.DATABASE_URL ??
  `postgres://${process.env.PGUSER || 'apgms'}:${encodeURIComponent(process.env.PGPASSWORD || '')}` +
  `@${process.env.PGHOST || '127.0.0.1'}:${process.env.PGPORT || '5432'}/${process.env.PGDATABASE || 'apgms'}`;

export const pool = new Pool({ connectionString });

export function createPaymentsApp() {
  const app = express();
  app.use(express.json());
  app.get('/health', (_req, res) => res.json({ ok: true }));
  app.post('/deposit', deposit);
  app.post('/payAto', rptGate, payAtoRelease);
  app.get('/balance', balance);
  app.get('/ledger', ledger);
  app.use((_req, res) => res.status(404).send('Not found'));
  return app;
}

const modulePath = fileURLToPath(import.meta.url);
const argvPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (argvPath && argvPath === modulePath) {
  const PORT = process.env.PORT ? Number(process.env.PORT) : 3001;
  const app = createPaymentsApp();
  app.listen(PORT, () => {
    console.log(`[payments] listening on http://localhost:${PORT}`);
  });
}

export async function startPaymentsServer(port = 0) {
  const app = createPaymentsApp();
  const server = app.listen(port);
  await once(server, 'listening');
  return server.address() as AddressInfo;
}
