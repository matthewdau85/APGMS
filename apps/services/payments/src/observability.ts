import { Request, Response, NextFunction } from 'express';
import { Pool } from 'pg';
import { Registry, Counter, Histogram, Gauge, collectDefaultMetrics } from 'prom-client';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';

const registry = new Registry();
let metricsRegistered = false;
let sdkStarted = false;
let sdk: NodeSDK | undefined;

const HTTP_BUCKETS = [
  0.005,
  0.01,
  0.025,
  0.05,
  0.1,
  0.25,
  0.5,
  1,
  2.5,
  5,
  10,
];

const httpRequests = new Counter({
  name: 'apgms_http_requests_total',
  help: 'Total HTTP requests processed',
  labelNames: ['service', 'version', 'env', 'method', 'route', 'status'],
  registers: [registry],
});

const httpLatency = new Histogram({
  name: 'apgms_http_request_duration_seconds',
  help: 'HTTP request duration seconds',
  labelNames: ['service', 'version', 'env', 'method', 'route'],
  buckets: HTTP_BUCKETS,
  registers: [registry],
});

const httpInFlight = new Gauge({
  name: 'apgms_http_requests_in_flight',
  help: 'In-flight HTTP requests',
  labelNames: ['service', 'version', 'env'],
  registers: [registry],
});

const serviceMetadata = new Gauge({
  name: 'apgms_service_metadata',
  help: 'Static service metadata',
  labelNames: ['service', 'version', 'env'],
  registers: [registry],
});

const dbPoolConnections = new Gauge({
  name: 'apgms_db_pool_connections',
  help: 'Database pool usage by state',
  labelNames: ['service', 'version', 'env', 'pool', 'state'],
  registers: [registry],
});

const dlqGauge = new Gauge({
  name: 'apgms_dlq_messages',
  help: 'Messages currently buffered in DLQ',
  labelNames: ['service', 'version', 'env', 'queue'],
  registers: [registry],
});

const releaseFailures = new Counter({
  name: 'apgms_release_failures_total',
  help: 'Release pipeline failures recorded by the service',
  labelNames: ['service', 'version', 'env', 'stage'],
  registers: [registry],
});

export interface ObservabilityOptions {
  service: string;
  version: string;
  env: string;
  otlpEndpoint?: string;
}

export interface ObservabilityHandles {
  middleware: (req: Request, res: Response, next: NextFunction) => void;
  metricsHandler: (req: Request, res: Response) => Promise<void>;
  trackDbPool: (pool: Pool, name?: string) => void;
  recordReleaseFailure: (stage: string) => void;
  setDlqDepth: (queue: string, depth: number) => void;
  labels: { service: string; version: string; env: string };
}

function ensureOtelStarted(options: ObservabilityOptions): void {
  if (sdkStarted) {
    return;
  }
  const traceEndpoint =
    process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT ??
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT ??
    options.otlpEndpoint ??
    'http://otel-collector:4318/v1/traces';
  const metricEndpoint =
    process.env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT ??
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT ??
    options.otlpEndpoint ??
    'http://otel-collector:4318/v1/metrics';

  sdk = new NodeSDK({
    serviceName: options.service,
    traceExporter: new OTLPTraceExporter({ url: traceEndpoint }),
    metricReader: new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter({ url: metricEndpoint }),
    }),
    instrumentations: [getNodeAutoInstrumentations()],
  });

  sdk
    .start()
    .then(() => {
      sdkStarted = true;
    })
    .catch((err) => {
      console.error('[observability] failed to start OpenTelemetry SDK', err);
    });

  const shutdown = async () => {
    if (!sdk) return;
    try {
      await sdk.shutdown();
    } catch (err) {
      console.error('[observability] failed to shutdown OpenTelemetry SDK', err);
    }
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

export function createObservability(options: ObservabilityOptions): ObservabilityHandles {
  if (!metricsRegistered) {
    registry.setDefaultLabels({
      service: options.service,
      version: options.version,
      env: options.env,
    });
    collectDefaultMetrics({ register: registry });
    metricsRegistered = true;
  }

  serviceMetadata.labels(options.service, options.version, options.env).set(1);
  ensureOtelStarted(options);

  const labelTuple = [options.service, options.version, options.env] as const;

  const middleware = (req: Request, res: Response, next: NextFunction) => {
    const start = process.hrtime.bigint();
    const method = req.method.toUpperCase();
    const routePath = req.route?.path ?? req.path ?? req.url;
    httpInFlight.labels(...labelTuple).inc();

    const done = (statusCode: number) => {
      const durationNs = Number(process.hrtime.bigint() - start);
      const durationSeconds = durationNs / 1e9;
      httpRequests.labels(...labelTuple, method, routePath, String(statusCode)).inc();
      httpLatency.labels(...labelTuple, method, routePath).observe(durationSeconds);
      httpInFlight.labels(...labelTuple).dec();
    };

    res.on('finish', () => done(res.statusCode));
    res.on('close', () => httpInFlight.labels(...labelTuple).dec());

    next();
  };

  const metricsHandler = async (_req: Request, res: Response) => {
    res.setHeader('Content-Type', registry.contentType);
    res.send(await registry.metrics());
  };

  const trackDbPool = (pool: Pool, name = 'default') => {
    const update = () => {
      dbPoolConnections.labels(...labelTuple, name, 'total').set(pool.totalCount);
      dbPoolConnections.labels(...labelTuple, name, 'idle').set(pool.idleCount);
      dbPoolConnections.labels(...labelTuple, name, 'waiting').set(pool.waitingCount);
      const active = Math.max(pool.totalCount - pool.idleCount, 0);
      dbPoolConnections.labels(...labelTuple, name, 'active').set(active);
    };
    update();
    pool.on('connect', update);
    pool.on('acquire', update);
    pool.on('release', update);
    pool.on('remove', update);
  };

  const recordReleaseFailure = (stage: string) => {
    releaseFailures.labels(...labelTuple, stage).inc();
  };

  const setDlqDepth = (queue: string, depth: number) => {
    dlqGauge.labels(...labelTuple, queue).set(depth);
  };

  return {
    middleware,
    metricsHandler,
    trackDbPool,
    recordReleaseFailure,
    setDlqDepth,
    labels: { service: options.service, version: options.version, env: options.env },
  };
}
