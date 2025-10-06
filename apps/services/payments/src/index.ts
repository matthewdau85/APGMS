// apps/services/payments/src/index.ts
import 'dotenv/config';
import './loadEnv.js'; // ensures .env.local is loaded when running with tsx

import express from 'express';
import promClient from 'prom-client';
import { randomUUID } from 'crypto';
import { context, propagation, trace } from '@opentelemetry/api';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { Resource } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import pg from 'pg'; const { Pool } = pg;

import { rptGate } from './middleware/rptGate.js';
import { payAtoRelease } from './routes/payAto.js';
import { deposit } from './routes/deposit';
import { balance } from './routes/balance';
import { ledger } from './routes/ledger';

const SERVICE_NAME = 'payments';

const otlpEndpoint = process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT || process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
const traceExporter = new OTLPTraceExporter({
  url: otlpEndpoint,
});

const sdk = new NodeSDK({
  traceExporter,
  resource: new Resource({
    [SemanticResourceAttributes.SERVICE_NAME]: SERVICE_NAME,
    [SemanticResourceAttributes.SERVICE_NAMESPACE]: 'apgms',
  }),
  instrumentations: [
    getNodeAutoInstrumentations({
      '@opentelemetry/instrumentation-http': {
        ignoreIncomingRequestHook: (req) => req.url === '/metrics',
      },
    }),
  ],
});

sdk.start().catch((err) => {
  console.error('[payments] failed to start OpenTelemetry SDK', err);
});

process.on('SIGTERM', () => {
  sdk
    .shutdown()
    .catch((err) => console.error('[payments] error shutting down OpenTelemetry SDK', err))
    .finally(() => process.exit(0));
});

// Metrics
promClient.collectDefaultMetrics({ prefix: `${SERVICE_NAME}_` });
const httpCounter =
  promClient.register.getSingleMetric('payments_http_requests_total') ??
  new promClient.Counter({
    name: 'payments_http_requests_total',
    help: 'Total HTTP requests processed',
    labelNames: ['method', 'route', 'status'],
  });
const httpDuration =
  promClient.register.getSingleMetric('payments_http_request_duration_seconds') ??
  new promClient.Histogram({
    name: 'payments_http_request_duration_seconds',
    help: 'Duration of HTTP requests in seconds',
    labelNames: ['method', 'route'],
    buckets: [0.05, 0.1, 0.2, 0.5, 1, 2, 5],
  });

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

app.use((req, res, next) => {
  const incoming = req.header('x-request-id');
  const requestId = incoming && incoming.trim() ? incoming.trim() : randomUUID();
  res.setHeader('x-request-id', requestId);
  (res.locals as { requestId?: string }).requestId = requestId;

  const active = context.active();
  const baggage = propagation.getBaggage(active)?.setEntry('x-request-id', { value: requestId })
    ?? propagation.createBaggage({ 'x-request-id': { value: requestId } });
  const ctxWithId = propagation.setBaggage(active, baggage);

  const start = process.hrtime.bigint();

  context.with(ctxWithId, () => {
    const span = trace.getSpan(context.active());
    span?.setAttribute('http.request_id', requestId);

    res.on('finish', () => {
      const elapsedNs = Number(process.hrtime.bigint() - start);
      const route = req.route?.path ?? req.path ?? req.url;
      const status = res.statusCode.toString();
      httpCounter.labels(req.method, route, status).inc();
      httpDuration.labels(req.method, route).observe(elapsedNs / 1e9);
    });

    next();
  });
});

// Health & metrics
app.get('/healthz', (_req, res) => res.json({ ok: true, service: SERVICE_NAME }));
app.get('/metrics', async (_req, res) => {
  res.setHeader('Content-Type', promClient.register.contentType);
  res.send(await promClient.register.metrics());
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
