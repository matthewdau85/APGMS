import { diag, DiagConsoleLogger, DiagLogLevel } from "@opentelemetry/api";
import type { Request, Response, NextFunction } from "express";
import { AsyncLocalStorage } from "node:async_hooks";
import type { ClientRequest } from "node:http";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";
import { ExpressInstrumentation } from "@opentelemetry/instrumentation-express";
import { Resource } from "@opentelemetry/resources";
import { SemanticResourceAttributes } from "@opentelemetry/semantic-conventions";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { v4 as uuidv4 } from "uuid";

const requestIdStorage = new AsyncLocalStorage<string>();

function parseHeaders(value?: string): Record<string, string> | undefined {
  if (!value) {
    return undefined;
  }

  const entries: Record<string, string> = {};
  for (const pair of value.split(",")) {
    const [key, val] = pair.split("=");
    if (key && val) {
      entries[key.trim()] = val.trim();
    }
  }

  return Object.keys(entries).length ? entries : undefined;
}

const httpInstrumentation = new HttpInstrumentation({
  requireParentforOutgoingSpans: false,
  requestHook: (_span, request) => {
    const requestId = requestIdStorage.getStore();
    if (!requestId) {
      return;
    }

    const candidate = request as ClientRequest & {
      setHeader?: (name: string, value: string) => void;
      getHeader?: (name: string) => number | string | string[] | undefined;
    };

    if (typeof candidate.setHeader !== "function") {
      return;
    }

    const existing = typeof candidate.getHeader === "function" ? candidate.getHeader("x-request-id") : undefined;
    if (!existing) {
      candidate.setHeader("x-request-id", requestId);
    }
  },
});

const expressInstrumentation = new ExpressInstrumentation();

let sdk: NodeSDK | undefined;
let started = false;

export function initOtel(): void {
  if (started) {
    return;
  }
  started = true;

  if (process.env.OTEL_LOG_LEVEL) {
    const levelKey = process.env.OTEL_LOG_LEVEL.toUpperCase();
    const levelValue = (DiagLogLevel as unknown as Record<string, DiagLogLevel>)[levelKey];
    if (levelValue !== undefined) {
      diag.setLogger(new DiagConsoleLogger(), levelValue);
    }
  } else if (process.env.NODE_ENV !== "production") {
    diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.INFO);
  }

  const resourceAttributes: Record<string, string> = {
    [SemanticResourceAttributes.SERVICE_NAME]:
      process.env.OTEL_SERVICE_NAME || process.env.npm_package_name || "apgms",
    [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: process.env.NODE_ENV || "development",
  };

  if (process.env.OTEL_SERVICE_NAMESPACE) {
    resourceAttributes[SemanticResourceAttributes.SERVICE_NAMESPACE] = process.env.OTEL_SERVICE_NAMESPACE;
  }

  const resource = Resource.default().merge(new Resource(resourceAttributes));

  const traceExporter = new OTLPTraceExporter({
    url:
      process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT ||
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT ||
      "http://localhost:4318/v1/traces",
    headers: parseHeaders(process.env.OTEL_EXPORTER_OTLP_HEADERS),
  });

  sdk = new NodeSDK({
    resource,
    traceExporter,
    instrumentations: [httpInstrumentation, expressInstrumentation],
  });

  sdk
    .start()
    .then(() => {
      if (process.env.NODE_ENV !== "production") {
        diag.info("OpenTelemetry tracing initialized");
      }
    })
    .catch((error) => {
      console.error("Failed to start OpenTelemetry SDK", error);
    });

  const shutdown = () => {
    sdk
      ?.shutdown()
      .catch((error) => console.error("Error shutting down OpenTelemetry SDK", error));
  };

  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}

export const requestIdMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  const incoming = (req.headers["x-request-id"] as string | undefined)?.trim();
  const requestId = incoming && incoming.length > 0 ? incoming : uuidv4();

  req.headers["x-request-id"] = requestId;
  res.setHeader("x-request-id", requestId);

  requestIdStorage.run(requestId, () => next());
};

export function getCurrentRequestId(): string | undefined {
  return requestIdStorage.getStore();
}
