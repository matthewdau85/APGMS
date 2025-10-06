// src/api/payments/index.ts
import { Router } from "express";

// NOTE: these paths point to your payments service source under apps/services/payments
// We import the handlers directly so your main app can proxy them at /api/*
import { balance } from "../../../apps/services/payments/src/routes/balance.js";
import { ledger } from "../../../apps/services/payments/src/routes/ledger.js";
import { deposit } from "../../../apps/services/payments/src/routes/deposit.js";
import { rptGate } from "../../../apps/services/payments/src/middleware/rptGate.js";
import { payAtoRelease } from "../../../apps/services/payments/src/routes/payAto.js";
import {
  authenticate,
  ensureRealModeTotp,
  requireDualApproval,
  requireRoles,
} from "../../../apps/services/payments/src/middleware/auth.js";

export const paymentsApi = Router();

// read-only
paymentsApi.get("/balance", authenticate, requireRoles("admin", "accountant", "auditor"), balance);
paymentsApi.get("/ledger", authenticate, requireRoles("admin", "accountant", "auditor"), ledger);

// write
paymentsApi.post("/deposit", authenticate, requireRoles("admin", "accountant"), deposit);
paymentsApi.post(
  "/release",
  authenticate,
  requireRoles("admin", "accountant"),
  ensureRealModeTotp,
  rptGate,
  (req, res) => {
    try {
      requireDualApproval(req, Math.abs(Number((req.body as any)?.amountCents || 0)));
    } catch (err: any) {
      return res.status(403).json({ error: err?.message || "DUAL_APPROVAL_FAILED" });
    }
    return payAtoRelease(req, res);
  },
);
