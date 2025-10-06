// src/index.ts
import express from "express";
import dotenv from "dotenv";

import { idempotency } from "./middleware/idempotency";
import { closeAndIssue, payAto, paytoSweep, settlementWebhook, evidence } from "./routes/reconcile";
import { paymentsApi } from "./api/payments"; // ✅ mount this BEFORE `api`
import { api } from "./api";                  // your existing API router(s)
import { httpLogger } from "./ops/logger";
import { securityHeaders } from "./ops/headers";
import { authenticate, requireRole } from "./http/auth";
import { requireRealModeMfa } from "./security/guards";
import { getMode, setMode } from "./security/mode";

dotenv.config();

export const app = express();

app.use(httpLogger);
for (const middleware of securityHeaders) {
  app.use(middleware);
}
app.use(express.json({ limit: "2mb" }));

// Simple health check
app.get("/health", (_req, res) => res.json({ ok: true }));

// Admin mode controls
app.get("/admin/mode", authenticate, requireRole("admin"), (_req, res) => {
  res.json({ mode: getMode() });
});

app.post("/admin/mode", authenticate, requireRole("admin"), (req, res) => {
  const mode = req.body?.mode;
  if (mode !== "sandbox" && mode !== "real") {
    return res.status(400).json({ error: "INVALID_MODE" });
  }
  if (mode === "real" && !req.auth?.mfa) {
    return res.status(403).json({ error: "MFA_REQUIRED" });
  }
  res.json({ mode: setMode(mode) });
});

// Existing explicit endpoints
app.post(
  "/api/pay",
  authenticate,
  requireRole("admin", "accountant"),
  requireRealModeMfa,
  idempotency(),
  payAto
);
app.post(
  "/api/close-issue",
  authenticate,
  requireRole("admin", "accountant"),
  requireRealModeMfa,
  closeAndIssue
);
app.post(
  "/api/payto/sweep",
  authenticate,
  requireRole("admin", "accountant"),
  requireRealModeMfa,
  paytoSweep
);
app.post(
  "/api/settlement/webhook",
  authenticate,
  requireRole("admin", "accountant"),
  requireRealModeMfa,
  settlementWebhook
);
app.get("/api/evidence", authenticate, requireRole("admin", "accountant", "auditor"), evidence);

// ✅ Payments API first so it isn't shadowed by catch-alls in `api`
app.use("/api", paymentsApi);

// Existing API router(s) after
app.use("/api", api);

// 404 fallback (must be last)
app.use((_req, res) => res.status(404).send("Not found"));

const port = Number(process.env.PORT) || 3000;
const envName = (process.env.NODE_ENV || "").toLowerCase().trim();
const skipListenFlag = (process.env.SKIP_LISTEN || "").toLowerCase().trim();
const shouldListen = envName !== "test" && skipListenFlag !== "true";

if (shouldListen) {
  app.listen(port, () => console.log("APGMS server listening on", port));
}
