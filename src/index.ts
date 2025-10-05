// src/index.ts
import express from "express";
import dotenv from "dotenv";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import cors from "cors";
import pino from "pino";
import pinoHttp from "pino-http";

import { idempotency } from "./middleware/idempotency";
import { closeAndIssue, payAto, paytoSweep } from "./routes/reconcile";
import { paymentsApi } from "./api/payments"; // ✅ mount this BEFORE `api`
import { api } from "./api"; // your existing API router(s)
import { auth } from "./http/auth";
import {
  evidenceRouter,
  reconcileRouter,
  settlementRouter,
} from "./api/v1";

dotenv.config();

const app = express();
app.use(express.json({ limit: "2mb" }));

const corsOrigins = (process.env.CORS_ORIGINS || "")
  .split(",")
  .filter(Boolean);
app.use(
  cors({ origin: corsOrigins.length ? corsOrigins : undefined, credentials: true })
);
app.use(helmet({ crossOriginResourcePolicy: { policy: "same-site" } }));
app.use(rateLimit({ windowMs: 60_000, max: 120 }));
const logger = pino({ level: process.env.LOG_LEVEL || "info" });
app.use(pinoHttp({ logger }));

// Simple health check
app.get("/health", (_req, res) => res.json({ ok: true }));

// Existing explicit endpoints
app.post(
  "/api/pay",
  auth(["accountant", "admin"]),
  idempotency(),
  payAto
);
app.post(
  "/api/close-issue",
  auth(["accountant", "admin"]),
  closeAndIssue
);
app.post(
  "/api/payto/sweep",
  auth(["accountant", "admin"]),
  paytoSweep
);

// Router aliases (protected) for structured mounts
app.use("/api/reconcile", auth(["accountant", "admin"]), reconcileRouter);
app.use(
  "/api/evidence",
  auth(["auditor", "accountant", "admin"]),
  evidenceRouter
);
app.use(
  "/api/settlement",
  auth(["accountant", "admin"]),
  settlementRouter
);

// ✅ Payments API first so it isn't shadowed by catch-alls in `api`
app.use("/api", paymentsApi);

// Existing API router(s) after
app.use("/api", api);

// 404 fallback (must be last)
app.use((_req, res) => res.status(404).send("Not found"));

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => console.log("APGMS server listening on", port));
