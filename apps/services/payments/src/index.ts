// apps/services/payments/src/index.ts
import 'dotenv/config';
import './loadEnv.js'; // ensures .env.local is loaded when running with tsx

import express from 'express';
import http from 'http';
import https from 'https';
import fs from 'fs';
import pg from 'pg'; const { Pool } = pg;

import { rptGate } from './middleware/rptGate.js';
import { payAtoRelease } from './routes/payAto.js';
import { deposit } from './routes/deposit';
import { balance } from './routes/balance';
import { ledger } from './routes/ledger';
import { authenticate, requireRoles } from './middleware/authn.js';

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
app.use(authenticate);

// Health check
app.get('/health', requireRoles(['payments:read']), (_req, res) => res.json({ ok: true }));

// Endpoints
app.post('/deposit', requireRoles('payments:write'), deposit);
app.post('/payAto', requireRoles(['payments:write', 'rpt:release']), rptGate, payAtoRelease);
app.get('/balance', requireRoles('payments:read'), balance);
app.get('/ledger', requireRoles('payments:read'), ledger);

// 404 fallback
app.use((_req, res) => res.status(404).send('Not found'));

const keyPath = process.env.TLS_KEY_PATH;
const certPath = process.env.TLS_CERT_PATH;
const caPath = process.env.TLS_CA_PATH;

if (keyPath && certPath) {
  const options: https.ServerOptions = {
    key: fs.readFileSync(keyPath),
    cert: fs.readFileSync(certPath),
  };
  if (caPath) {
    options.ca = fs.readFileSync(caPath);
  }
  https.createServer(options, app).listen(PORT, () => {
    console.log(`[payments] listening with TLS on port ${PORT}`);
  });
} else {
  http.createServer(app).listen(PORT, () => {
    console.log(`[payments] listening on http://localhost:${PORT}`);
  });
}
