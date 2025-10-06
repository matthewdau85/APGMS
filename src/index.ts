// src/index.ts
import express from "express";
import dotenv from "dotenv";
import helmet from "helmet";
import rateLimit from "express-rate-limit";

import { idempotency } from "./middleware/idempotency";
import { requestContext } from "./middleware/requestContext";
import { authenticateJwt, requireRole, requireTotp } from "./middleware/security";
import { closeAndIssue, payAto, paytoSweep, settlementWebhook, evidence } from "./routes/reconcile";
import { upsertAllowlist } from "./routes/allowlist";
import { paymentsApi } from "./api/payments"; // ✅ mount this BEFORE `api`
import { api } from "./api";                  // your existing API router(s)
import { securityConfig } from "./config/security";
import { announceRetention, logSecurityEvent } from "./security/logger";

dotenv.config();

announceRetention();

const sensitiveWindow = Number.isFinite(securityConfig.sensitiveRateWindowMs)
  ? securityConfig.sensitiveRateWindowMs
  : 5 * 60 * 1000;
const sensitiveLimit = Number.isFinite(securityConfig.sensitiveRateLimit) && securityConfig.sensitiveRateLimit > 0
  ? securityConfig.sensitiveRateLimit
  : 8;

const sensitiveLimiter = rateLimit({
  windowMs: sensitiveWindow,
  limit: sensitiveLimit,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logSecurityEvent(req, "rate_limit_block", { limit: sensitiveLimit, window_ms: sensitiveWindow });
    res.status(429).json({ error: "RATE_LIMIT" });
  },
  keyGenerator: (req) => req.ip ?? req.requestId ?? "unknown",
});

const app = express();
app.use(helmet());
app.use(express.json({ limit: "2mb" }));
app.use(requestContext);

// Simple health check
app.get("/health", (_req, res) => res.json({ ok: true }));

// Existing explicit endpoints
const releaseGuards = [authenticateJwt, requireRole("release:execute"), sensitiveLimiter, requireTotp("release")];
app.post("/api/pay", ...releaseGuards, idempotency(), payAto);
app.post("/api/close-issue", closeAndIssue);
app.post("/api/payto/sweep", paytoSweep);
app.post("/api/settlement/webhook", settlementWebhook);
const evidenceGuards = [authenticateJwt, requireRole("evidence:read"), sensitiveLimiter, requireTotp("evidence_export")];
app.get("/api/evidence", ...evidenceGuards, evidence);
const allowlistGuards = [authenticateJwt, requireRole("allowlist:write"), sensitiveLimiter, requireTotp("allowlist_update")];
app.post("/api/remittance/allowlist", ...allowlistGuards, upsertAllowlist);

// ✅ Payments API first so it isn't shadowed by catch-alls in `api`
app.use("/api", paymentsApi);

// Existing API router(s) after
app.use("/api", api);

// 404 fallback (must be last)
app.use((_req, res) => res.status(404).send("Not found"));

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => console.log("APGMS server listening on", port));
