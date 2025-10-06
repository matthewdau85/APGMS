// src/index.ts
import express from "express";
import dotenv from "dotenv";

import { idempotency } from "./middleware/idempotency";
import {
  closeAndIssue,
  payAto,
  paytoSweep,
  settlementWebhook,
  evidence,
} from "./routes/reconcile";
import { paymentsApi } from "./api/payments"; // ✅ mount this BEFORE `api`
import { api } from "./api"; // your existing API router(s)
import { FEATURES, assertSafeBoot } from "./config/features";
import { modeHeaders } from "./http/modeHeaders";

dotenv.config();
assertSafeBoot();

const app = express();
app.use(express.json({ limit: "2mb" }));
app.use(modeHeaders);

// (optional) quick request logger
app.use((req, _res, next) => {
  console.log(`[app] ${req.method} ${req.url}`);
  next();
});

console.log(
  `[boot] APP_MODE=${FEATURES.APP_MODE} simulated=${FEATURES.SIM_INBOUND || FEATURES.SIM_OUTBOUND || FEATURES.DRY_RUN || FEATURES.SHADOW_ONLY}`
);

// Simple health check
app.get("/health", (_req, res) => res.json({ ok: true }));

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
