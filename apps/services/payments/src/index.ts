// apps/services/payments/src/index.ts
import 'dotenv/config';
import './loadEnv.js'; // ensures .env.local is loaded when running with tsx

import express from 'express';
import pg from 'pg'; const { Pool } = pg;

import { rptGate } from './middleware/rptGate.js';
import { release } from './routes/release.js';
import { deposit } from './routes/deposit';
import { balance } from './routes/balance';
import { ledger } from './routes/ledger';
import { simBpay, simEft, simReconFile } from './routes/simRail.js';
import { settlementImport } from './routes/settlementImport.js';

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

// Health check
app.get('/health', (_req, res) => res.json({ ok: true }));

// Endpoints
app.post('/deposit', deposit);
app.post('/release', rptGate, release);
app.get('/balance', balance);
app.get('/ledger', ledger);
app.get('/sim/rail/recon-file', simReconFile);
app.post('/settlement/import', settlementImport);
app.post('/sim/bank/eft', simEft);
app.post('/sim/bank/bpay', simBpay);

// 404 fallback
app.use((_req, res) => res.status(404).send('Not found'));

// Start server
app.listen(PORT, () => {
  console.log(`[payments] listening on http://localhost:${PORT}`);
});
