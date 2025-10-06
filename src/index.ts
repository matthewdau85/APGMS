import dotenv from "dotenv";
import express, { NextFunction, Request, RequestHandler, Response } from "express";
import { randomUUID } from "node:crypto";
import { context, propagation, trace } from "./telemetry/api";
import { NodeSDK } from "./telemetry/nodeSdk";
import { Resource } from "./telemetry/resource";
import { SemanticResourceAttributes } from "./telemetry/semanticConventions";
import { OTLPTraceExporter } from "./telemetry/otlpHttpExporter";
import { MetricsRegistry, createCounter, createHistogram, collectDefaultMetrics } from "./metrics/registry";
import { createRateLimiter } from "./middleware/rateLimit";

import { api } from "./api";
import { paymentsApi } from "./api/payments";
import { idempotency } from "./middleware/idempotency";
import { authenticate, requireMfa, requireRole } from "./middleware/auth";
import { deposit } from "./routes/deposit";
import { evidence, closeAndIssue, payAto, paytoSweep, settlementWebhook } from "./routes/reconcile";
import { mfaRouter } from "./routes/mfa";
import { pool } from "./db/pool";

dotenv.config();

const otlpEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT || "http://localhost:4318/v1/traces";
const sdk = new NodeSDK({
  resource: new Resource({
    [SemanticResourceAttributes.SERVICE_NAME]: "apgms-api",
  }),
  traceExporter: new OTLPTraceExporter({ url: otlpEndpoint }),
});

sdk.start().catch((err) => {
  console.error("Failed to start OpenTelemetry SDK", err);
});

process.on("SIGTERM", () => {
  sdk
    .shutdown()
    .then(() => console.log("OTel SDK shutdown complete"))
    .catch((err) => console.error("Error shutting down OTel SDK", err))
    .finally(() => process.exit(0));
});

const tracer = trace.getTracer("apgms-http");

const register = new MetricsRegistry();
collectDefaultMetrics(register);

const requestCounter = createCounter(register, {
  name: "http_requests_total",
  help: "Total HTTP requests",
  labelNames: ["method", "route", "status"],
});

const errorCounter = createCounter(register, {
  name: "http_request_errors_total",
  help: "Total HTTP error responses",
  labelNames: ["method", "route", "status"],
});

const latencyHistogram = createHistogram(register, {
  name: "http_request_duration_seconds",
  help: "HTTP request duration in seconds",
  labelNames: ["method", "route", "status"],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
});

const app = express();
app.set("trust proxy", true);
app.use(express.json({ limit: "2mb" }));

const allowedOrigins = (process.env.CORS_ALLOWLIST || "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

const applySecurityHeaders: RequestHandler = (_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cross-Origin-Resource-Policy", "same-site");
  next();
};

const corsMiddleware: RequestHandler = (req, res, next) => {
  const origin = req.headers.origin;
  if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
    const responseOrigin = origin || "*";
    res.setHeader("Access-Control-Allow-Origin", responseOrigin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Allow-Headers", "Authorization,Content-Type,X-Request-Id");
    res.setHeader("Access-Control-Expose-Headers", "X-Request-Id");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
    if (req.method === "OPTIONS") {
      return res.status(204).send();
    }
    return next();
  }
  return res.status(403).json({ error: "CORS_NOT_ALLOWED" });
};

app.use(applySecurityHeaders);
app.use(corsMiddleware);

app.use((req, res, next) => {
  const incoming = req.header("x-request-id");
  const validIncoming = incoming && /^[A-Za-z0-9\-_/]{1,64}$/.test(incoming) ? incoming : undefined;
  const requestId = validIncoming || randomUUID();
  req.requestId = requestId;
  res.locals.routePath = req.path;
  res.setHeader("x-request-id", requestId);
  req.log = (level, message, meta = {}) => {
    const entry = {
      level,
      message,
      requestId,
      time: new Date().toISOString(),
      userId: req.user?.id,
      ...meta,
    };
    console.log(JSON.stringify(entry));
  };
  next();
});

app.use((req, res, next) => {
  req.log("info", "request.start", { method: req.method, path: req.path });
  res.on("finish", () => {
    req.log("info", "request.finish", { statusCode: res.statusCode });
  });
  next();
});

app.use((req, res, next) => {
  const extracted = propagation.extract(context.active(), req.headers as Record<string, string>);
  const span = tracer.startSpan(`${req.method} ${req.path}`, undefined, extracted);
  const start = process.hrtime.bigint();
  const ctxWithSpan = new Map(extracted);
  ctxWithSpan.set("x-request-id", req.requestId);
  ctxWithSpan.set("active-span", span);
  res.on("finish", () => {
    const route = res.locals.routePath || req.path;
    const status = String(res.statusCode);
    requestCounter.inc({ method: req.method, route, status });
    if (res.statusCode >= 400) {
      errorCounter.inc({ method: req.method, route, status });
    }
    const durationNs = Number(process.hrtime.bigint() - start);
    latencyHistogram.observe({ method: req.method, route, status }, durationNs / 1e9);
    span.setAttributes({
      "http.method": req.method,
      "http.route": route,
      "http.status_code": res.statusCode,
      "http.request_id": req.requestId,
    });
    span.end();
  });
  context.with(ctxWithSpan, next);
});

const authedLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 120,
});

const asyncHandler = (handler: RequestHandler): RequestHandler => {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
};

const setRoute = (route: string): RequestHandler => (req, res, next) => {
  res.locals.routePath = route;
  next();
};

app.get(
  "/healthz",
  setRoute("/healthz"),
  asyncHandler(async (req, res) => {
    try {
      await pool.query("SELECT 1");
      res.json({ ok: true, db: true });
    } catch (error: any) {
      req.log("error", "healthz_db_error", { error: error?.message ?? String(error) });
      res.status(503).json({ ok: false, db: false });
    }
  })
);

app.get(
  "/metrics",
  setRoute("/metrics"),
  asyncHandler(async (_req, res) => {
    res.set("Content-Type", register.contentType);
    res.send(register.metrics());
  })
);

app.use(
  "/auth/mfa",
  (req, res, next) => {
    res.locals.routePath = `/auth/mfa${req.path}`;
    next();
  },
  authenticate,
  authedLimiter,
  mfaRouter
);

app.post(
  "/api/deposit",
  setRoute("/api/deposit"),
  authenticate,
  authedLimiter,
  requireRole("operator"),
  requireMfa,
  asyncHandler(deposit)
);

app.post(
  "/api/pay",
  setRoute("/api/pay"),
  authenticate,
  authedLimiter,
  requireRole("approver"),
  requireMfa,
  idempotency(),
  asyncHandler(payAto)
);

app.post(
  "/api/close-issue",
  setRoute("/api/close-issue"),
  authenticate,
  authedLimiter,
  requireRole("operator"),
  asyncHandler(closeAndIssue)
);

app.post(
  "/api/payto/sweep",
  setRoute("/api/payto/sweep"),
  authenticate,
  authedLimiter,
  requireRole("approver"),
  requireMfa,
  asyncHandler(paytoSweep)
);

app.post(
  "/api/settlement/webhook",
  setRoute("/api/settlement/webhook"),
  authenticate,
  authedLimiter,
  requireRole("operator"),
  asyncHandler(settlementWebhook)
);

app.get(
  "/api/evidence",
  setRoute("/api/evidence"),
  authenticate,
  authedLimiter,
  requireRole("viewer"),
  asyncHandler(evidence)
);

app.use("/api", paymentsApi);
app.use("/api", api);

app.use((req, res) => {
  res.status(404).json({ error: "NOT_FOUND" });
});

app.use((err: any, req: Request, res: Response, _next: NextFunction) => {
  req.log?.("error", "unhandled_error", { error: err?.message ?? String(err) });
  res.status(500).json({ error: "INTERNAL_SERVER_ERROR" });
});

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => console.log("APGMS server listening on", port));
