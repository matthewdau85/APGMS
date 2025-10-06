// src/index.ts
import express from "express";
import dotenv from "dotenv";

import { idempotency } from "./middleware/idempotency";
import { closeAndIssue, payAto, paytoSweep, settlementWebhook, evidence } from "./routes/reconcile";
import { paymentsApi } from "./api/payments"; // ✅ mount this BEFORE `api`
import { api } from "./api"; // your existing API router(s)
import { applySecurityHeaders, getCorsAllowList, setCorsAllowList } from "./ops/headers";
import { authenticate, requireRole } from "./http/auth";
import { createMfaRouter } from "./security/mfa";
import { dualApprovals } from "./approvals/dual";
import { getAppMode, setAppMode } from "./state/settings";

dotenv.config();

const app = express();
app.use(express.json({ limit: "2mb" }));
applySecurityHeaders(app);

// (optional) quick request logger
app.use((req, _res, next) => { console.log(`[app] ${req.method} ${req.url}`); next(); });

app.use("/auth/mfa", authenticate, createMfaRouter());

app.get("/ops/mode", authenticate, requireRole("admin", "accountant", "auditor"), (_req, res) => {
  res.json({ mode: getAppMode() });
});

app.post("/ops/mode", authenticate, requireRole("admin"), (req, res) => {
  const { mode } = req.body || {};
  if (mode !== "demo" && mode !== "real") {
    return res.status(400).json({ error: "INVALID_MODE" });
  }
  setAppMode(mode);
  res.json({ ok: true, mode });
});

app.get("/ops/allowlist", authenticate, requireRole("admin", "accountant"), (_req, res) => {
  res.json({ origins: getCorsAllowList() });
});

app.put("/ops/allowlist", authenticate, requireRole("admin"), (req, res) => {
  const { origins } = req.body || {};
  if (!Array.isArray(origins)) {
    return res.status(400).json({ error: "INVALID_ALLOWLIST" });
  }
  setCorsAllowList(origins.map((origin: unknown) => String(origin)));
  res.json({ ok: true, origins: getCorsAllowList() });
});

app.get("/ops/approvals", authenticate, requireRole("admin", "accountant", "auditor"), (_req, res) => {
  res.json({ pending: dualApprovals.listPending() });
});

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

app.use((err: any, _req, res, next) => {
  if (err?.message === "Origin not allowed by CORS") {
    return res.status(403).json({ error: "CORS_NOT_ALLOWED" });
  }
  return next(err);
});

// 404 fallback (must be last)
app.use((_req, res) => res.status(404).send("Not found"));

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => console.log("APGMS server listening on", port));
