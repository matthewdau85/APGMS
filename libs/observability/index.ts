import { randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { Request, Response, NextFunction } from 'express';
import client from 'prom-client';
import { diag, DiagConsoleLogger, DiagLogLevel } from '@opentelemetry/api';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { Resource } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';

interface ObservabilityOptions {
  serviceName: string;
}

interface RequestContext {
  requestId: string;
}

const asyncStorage = new AsyncLocalStorage<RequestContext>();

export function getCurrentRequestId(): string | undefined {
  return asyncStorage.getStore()?.requestId;
}

function resolveEndpointUrl(): string | undefined {
  const explicit = process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT;
  if (explicit) {
    return explicit;
  }
  const generic = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (generic) {
    const trimmed = generic.endsWith('/') ? generic.slice(0, -1) : generic;
    return `${trimmed}/v1/traces`;
  }
  return undefined;
}

function parseHeaders(): Record<string, string> | undefined {
  const raw = process.env.OTEL_EXPORTER_OTLP_HEADERS;
  if (!raw) {
    return undefined;
  }
  const headers: Record<string, string> = {};
  for (const part of raw.split(',')) {
    const [key, ...rest] = part.split('=');
    if (!key || rest.length === 0) continue;
    headers[key.trim()] = rest.join('=').trim();
  }
  return headers;
}

let startedSdk: NodeSDK | null = null;
let shuttingDown = false;

export function initializeTelemetry(options: ObservabilityOptions): void {
  if (startedSdk) {
    return;
  }

  diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.ERROR);

  const exporter = new OTLPTraceExporter({
    url: resolveEndpointUrl(),
    headers: parseHeaders(),
  });

  const sdk = new NodeSDK({
    resource: new Resource({
      [SemanticResourceAttributes.SERVICE_NAME]: options.serviceName,
    }),
    traceExporter: exporter,
    instrumentations: [getNodeAutoInstrumentations()],
  });

  sdk
    .start()
    .then(() => {
      console.log(`[telemetry] OpenTelemetry started for ${options.serviceName}`);
    })
    .catch((err) => {
      console.error('[telemetry] failed to start', err);
    });

  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    try {
      await sdk.shutdown();
      console.log('[telemetry] gracefully shut down');
    } catch (err) {
      console.error('[telemetry] shutdown error', err);
    }
  };

  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
  process.once('beforeExit', shutdown);

  startedSdk = sdk;
}

function resolveRoute(req: Request): string {
  if (req.route?.path) {
    return req.baseUrl ? `${req.baseUrl}${req.route.path}` : req.route.path;
  }
  if (req.originalUrl) {
    return req.originalUrl.split('?')[0];
  }
  return req.url || 'unknown';
}

export function createExpressObservability(options: ObservabilityOptions) {
  const register = new client.Registry();
  register.setDefaultLabels({ service: options.serviceName });
  client.collectDefaultMetrics({ register });

  const requestCounter = new client.Counter({
    name: 'http_server_requests_total',
    help: 'Total number of HTTP requests received',
    labelNames: ['method', 'route', 'status_code'],
    registers: [register],
  });

  const requestDuration = new client.Histogram({
    name: 'http_server_request_duration_seconds',
    help: 'Duration of HTTP requests in seconds',
    labelNames: ['method', 'route', 'status_code'],
    buckets: [
      0.005, 0.01, 0.025, 0.05,
      0.1, 0.25, 0.5, 1, 2.5, 5, 10,
    ],
    registers: [register],
  });

  return {
    metricsHandler: async (_req: Request, res: Response) => {
      res.setHeader('Content-Type', register.contentType);
      res.end(await register.metrics());
    },
    requestMiddleware: (req: Request, res: Response, next: NextFunction) => {
      const incoming = req.header('x-request-id');
      const requestId = incoming && incoming.trim().length > 0 ? incoming.trim() : randomUUID();
      (req as any).requestId = requestId;
      res.locals.requestId = requestId;
      res.setHeader('x-request-id', requestId);

      const originalJson = res.json.bind(res);
      res.json = ((body: any) => {
        if (body && typeof body === 'object' && !Buffer.isBuffer(body)) {
          if (body.requestId === undefined) {
            body.requestId = requestId;
          }
        }
        return originalJson(body);
      }) as typeof res.json;

      const start = process.hrtime.bigint();

      asyncStorage.run({ requestId }, () => {
        res.on('finish', () => {
          const durationNs = Number(process.hrtime.bigint() - start);
          const durationSeconds = durationNs / 1e9;
          const route = resolveRoute(req);
          const statusCode = res.statusCode.toString();
          const labels = { method: req.method, route, status_code: statusCode } as const;
          requestCounter.inc(labels);
          requestDuration.observe(labels, durationSeconds);
          const durationMs = (durationNs / 1e6).toFixed(2);
          console.log(
            `[${options.serviceName}] ${req.method} ${route} ${statusCode} ${durationMs}ms requestId=${requestId}`
          );
        });
        next();
      });
    },
  };
}
