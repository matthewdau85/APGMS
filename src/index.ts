// src/index.ts
import express from "express";
import dotenv from "dotenv";

import { idempotency } from "./middleware/idempotency";
import { requestContext } from "./middleware/requestContext";
import { requestLogger } from "./middleware/requestLogger";
import { httpMetricsMiddleware, metricsHandler } from "./observability/metrics";
import { initTelemetry } from "./observability/otel";
import { closeAndIssue, payAto, paytoSweep, settlementWebhook, evidence } from "./routes/reconcile";
import { paymentsApi } from "./api/payments"; // ✅ mount this BEFORE `api`
import { api } from "./api"; // your existing API router(s)

dotenv.config();
initTelemetry("apgms-api");

export function createApp() {
  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use(requestContext());
  app.use(requestLogger());
  app.use(httpMetricsMiddleware);

  app.get("/health", (_req, res) => res.json({ ok: true }));
  app.get("/healthz", (_req, res) => res.json({ status: "ok" }));
  app.get("/metrics", metricsHandler);

  app.post("/api/pay", idempotency(), payAto);
  app.post("/api/close-issue", closeAndIssue);
  app.post("/api/payto/sweep", paytoSweep);
  app.post("/api/settlement/webhook", settlementWebhook);
  app.get("/api/evidence", evidence);

  app.use("/api", paymentsApi);
  app.use("/api", api);

  app.use((_req, res) => res.status(404).send("Not found"));

  return app;
}

if (process.env.NODE_ENV !== "test") {
  const app = createApp();
  const port = Number(process.env.PORT) || 3000;
  app.listen(port, () => {
    console.log(JSON.stringify({ msg: "apgms-api listening", port }));
  });
}
