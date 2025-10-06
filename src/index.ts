// src/index.ts
import express from "express";
import dotenv from "dotenv";

import { idempotency } from "./middleware/idempotency";
import { closeAndIssue, payAto, paytoSweep, settlementWebhook, evidence, loadRelease } from "./routes/reconcile";
import { paymentsApi } from "./api/payments";
import { api } from "./api";
import { applySecurity } from "./ops/headers";
import { httpLogger, errorResponder, requestCompleted } from "./ops/logs";
import { authenticate } from "./http/auth";
import { requireMfaForAction } from "./security/mfa";
import { requireDualApproval } from "./approvals/dual";
import { toggleMode, updateAllowList } from "./routes/security";

dotenv.config();

const dualThreshold = Number(process.env.RELEASE_DUAL_THRESHOLD_CENTS || 100_000_00);

const app = express();
app.use(express.json({ limit: "2mb" }));
applySecurity(app);
app.use(httpLogger);
app.use(requestCompleted);

// Simple health check
app.get("/health", (_req, res) => res.json({ ok: true }));

// Existing explicit endpoints
app.post(
  "/api/pay",
  authenticate(["admin", "accountant"]),
  requireMfaForAction("release"),
  loadRelease,
  requireDualApproval({
    thresholdCents: dualThreshold,
    buildContext: (req) => {
      const release = (req.res as any)?.locals?.release;
      return {
        id: `release:${req.body.abn}:${req.body.taxType}:${req.body.periodId}`,
        amountCents: Number(release?.payload?.amount_cents || 0),
      };
    },
  }),
  idempotency(),
  payAto
);
app.post("/api/close-issue", authenticate(["admin", "accountant"]), closeAndIssue);
app.post("/api/payto/sweep", authenticate(["admin", "accountant"]), paytoSweep);
app.post("/api/settlement/webhook", authenticate(["admin", "auditor", "accountant"]), settlementWebhook);
app.get("/api/evidence", authenticate(["auditor", "accountant", "admin"]), evidence);
app.post(
  "/api/mode/toggle",
  authenticate(["admin"]),
  requireMfaForAction("mode"),
  requireDualApproval({
    thresholdCents: 0,
    buildContext: (req) => ({
      id: `mode:${req.auth?.userId}:${req.body.mode || "unknown"}`,
      amountCents: 1,
    }),
  }),
  toggleMode
);
app.post(
  "/api/allow-list",
  authenticate(["admin", "accountant"]),
  requireMfaForAction("allow-list"),
  requireDualApproval({
    thresholdCents: 0,
    buildContext: (req) => ({
      id: `allow:${req.auth?.userId}:${req.body.origin || "unknown"}`,
      amountCents: 1,
    }),
  }),
  updateAllowList
);

// ✅ Payments API first so it isn't shadowed by catch-alls in `api`
app.use("/api", paymentsApi);

// Existing API router(s) after
app.use("/api", api);

// 404 fallback (must be last)
app.use((_req, res) => res.status(404).send("Not found"));
app.use(errorResponder);

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => console.log("APGMS server listening on", port));
