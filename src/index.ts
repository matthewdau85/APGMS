// src/index.ts
import express, { ErrorRequestHandler } from "express";
import dotenv from "dotenv";

import { idempotency } from "./middleware/idempotency";
import { closeAndIssue, payAto, paytoSweep, settlementWebhook, evidence } from "./routes/reconcile";
import { paymentsApi } from "./api/payments"; // ✅ mount this BEFORE `api`
import { api } from "./api";                  // your existing API router(s)
import { requestIdMiddleware } from "./middleware/requestId";
import { initTracing } from "./observability/tracing";
import { gatherHealth } from "./observability/health";
import { registry } from "./observability/metrics";

dotenv.config();
void initTracing();

const app = express();
app.use(requestIdMiddleware);
app.use(express.json({ limit: "2mb" }));

app.use((req, res, next) => {
  const originalJson = res.json.bind(res);
  res.json = ((body?: any) => {
    if (body && typeof body === "object" && !Array.isArray(body)) {
      body = { ...body, requestId: req.requestId };
    }
    return originalJson(body);
  }) as typeof res.json;
  next();
});

// request logger with requestId context
app.use((req, res, next) => {
  const start = Date.now();
  console.log(`[app] ${req.method} ${req.url} reqId=${req.requestId}`);
  res.on("finish", () => {
    const duration = Date.now() - start;
    console.log(
      `[app] ${req.method} ${req.url} reqId=${req.requestId} status=${res.statusCode} duration=${duration}ms`
    );
  });
  next();
});

// Simple health check
app.get("/health", (_req, res) => res.json({ ok: true }));

app.get("/healthz", async (req, res) => {
  const report = await gatherHealth();
  const status = report.ok ? 200 : 503;
  res.status(status).json({ ...report, requestId: req.requestId });
});

app.get("/metrics", async (_req, res) => {
  res.setHeader("Content-Type", registry.contentType);
  res.send(await registry.metrics());
});

// Existing explicit endpoints
app.post("/api/pay", idempotency(), payAto);
app.post("/api/close-issue", closeAndIssue);
app.post("/api/payto/sweep", paytoSweep);
app.post("/api/settlement/webhook", settlementWebhook);
app.get("/api/evidence", evidence);

// ✅ Payments API first so it isn't shadowed by catch-alls in `api`
app.use("/api", paymentsApi);

// Existing API router(s) after
app.use("/api", api);

// 404 fallback (must be last)
app.use((req, res) => res.status(404).json({ error: "Not found", requestId: req.requestId }));

const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
  const status = err?.status || 500;
  console.error("[app] request failed", { requestId: req.requestId, error: err });
  if (res.headersSent) {
    return next(err);
  }

  const payload = {
    error: status === 500 ? "Internal Server Error" : err?.message || "Error",
    requestId: req.requestId,
  };

  res.status(status).json(payload);
};

app.use(errorHandler);

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => console.log("APGMS server listening on", port));
