// src/index.ts
import dotenv from "dotenv";
import express from "express";

import { httpMetrics, registerHealthEndpoints } from "./ops/health";
import { initOtel, requestIdMiddleware } from "./otel";
import { paymentsApi } from "./api/payments"; // ✅ mount this BEFORE `api`
import { api } from "./api"; // your existing API router(s)
import { idempotency } from "./middleware/idempotency";
import { closeAndIssue, evidence, payAto, paytoSweep, settlementWebhook } from "./routes/reconcile";

dotenv.config();
initOtel();

const app = express();
app.use(requestIdMiddleware);
app.use(httpMetrics);
app.use(express.json({ limit: "2mb" }));

// (optional) quick request logger
app.use((req, _res, next) => { console.log(`[app] ${req.method} ${req.url}`); next(); });
registerHealthEndpoints(app);

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
