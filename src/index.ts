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
  validateCloseAndIssue,
  validatePayAto,
  validatePaytoSweep,
} from "./routes/reconcile";
import { paymentsApi } from "./api/payments"; // ✅ mount this BEFORE `api`
import { api } from "./api";                  // your existing API router(s)
import { securityHeaders } from "./middleware/securityHeaders";
import { cors } from "./middleware/cors";
import { rateLimit } from "./middleware/rateLimit";
import { auditTrail } from "./middleware/auditTrail";
import { requireRole } from "./http/auth";

dotenv.config();

const app = express();
app.disable("x-powered-by");

const corsOrigins = (process.env.CORS_ORIGINS || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(securityHeaders());
app.use(cors({ origins: corsOrigins }));
app.use(rateLimit({ windowMs: 60_000, max: 120 }));
app.use(express.json({ limit: "2mb" }));
app.use(auditTrail());

// (optional) quick request logger
app.use((req, _res, next) => { console.log(`[app] ${req.method} ${req.url}`); next(); });

// Simple health check
app.get("/health", (_req, res) => res.json({ ok: true }));

// Existing explicit endpoints
const accountantAccess = requireRole("accountant", "admin");
const auditorAccess = requireRole("auditor", "accountant", "admin");
const adminAccess = requireRole("admin");

app.post("/api/pay", accountantAccess, validatePayAto, idempotency(), payAto);
app.post("/api/close-issue", accountantAccess, validateCloseAndIssue, closeAndIssue);
app.post("/api/payto/sweep", accountantAccess, validatePaytoSweep, paytoSweep);
app.post("/api/settlement/webhook", adminAccess, settlementWebhook);
app.get("/api/evidence", auditorAccess, evidence);

// ✅ Payments API first so it isn't shadowed by catch-alls in `api`
app.use("/api", auditorAccess, paymentsApi);

// Existing API router(s) after
app.use("/api", auditorAccess, api);

// 404 fallback (must be last)
app.use((_req, res) => res.status(404).send("Not found"));

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => console.log("APGMS server listening on", port));
