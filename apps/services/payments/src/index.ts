// apps/services/payments/src/index.ts
import 'dotenv/config';
import './loadEnv.js'; // ensures .env.local is loaded when running with tsx

import express from 'express';
import pg from 'pg'; const { Pool } = pg;

import { rptGate } from './middleware/rptGate.js';
import { payAtoRelease } from './routes/payAto.js';
import { deposit } from './routes/deposit.js';
import { balance } from './routes/balance.js';
import { ledger } from './routes/ledger.js';
import { traceMiddleware } from './observability/trace.js';
import { logInfo } from './observability/logger.js';
import { register, startTimer } from './observability/metrics.js';
import { checkDependencies } from './observability/readiness.js';

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
app.disable('x-powered-by');
app.use(express.json());
app.use(traceMiddleware());

app.use((req, res, next) => {
  const timer = startTimer({ route: req.path, method: req.method });
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    timer(res.statusCode);
    const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
    logInfo(res, 'request.complete', {
      method: req.method,
      route: req.path,
      status: res.statusCode,
      duration_ms: durationMs,
    });
  });
  next();
});

app.get('/healthz', (_req, res) => res.json({ ok: true }));

app.get('/readyz', async (_req, res) => {
  const deps = await checkDependencies(pool);
  const ready = deps.db && deps.kms && deps.nats;
  if (!ready) {
    return res.status(503).json({ ready: false, dependencies: deps });
  }
  return res.json({ ready: true, dependencies: deps });
});

app.get('/metrics', async (_req, res) => {
  res.set('content-type', register.contentType);
  res.send(await register.metrics());
});

// Endpoints
app.post('/deposit', deposit);
app.post('/payAto', rptGate, payAtoRelease);
app.get('/balance', balance);
app.get('/ledger', ledger);

// 404 fallback
app.use((_req, res) => res.status(404).send('Not found'));

// Start server
app.listen(PORT, () => {
  console.log(`[payments] listening on http://localhost:${PORT}`);
});
