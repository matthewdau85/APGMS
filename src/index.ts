// src/index.ts
import express from "express";
import dotenv from "dotenv";

import { createExpressObservability, initializeTelemetry } from "../libs/observability/index.js";
import { idempotency } from "./middleware/idempotency";
import { closeAndIssue, payAto, paytoSweep, settlementWebhook, evidence } from "./routes/reconcile";
import { paymentsApi } from "./api/payments"; // ✅ mount this BEFORE `api`
import { api } from "./api";                  // your existing API router(s)

dotenv.config();

initializeTelemetry({ serviceName: "apgms-app" });

const observability = createExpressObservability({ serviceName: "apgms-app" });

const app = express();
app.use(observability.requestMiddleware);
app.use(express.json({ limit: "2mb" }));

// Health and metrics
app.get(["/health", "/healthz"], (_req, res) => res.json({ ok: true }));
app.get("/metrics", observability.metricsHandler);

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
app.use((_req, res) => res.status(404).send("Not found"));

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => console.log("APGMS server listening on", port));
