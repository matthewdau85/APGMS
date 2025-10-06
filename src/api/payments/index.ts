// src/api/payments/index.ts
import { Router } from "express";

// NOTE: these paths point to your payments service source under apps/services/payments
// We import the handlers directly so your main app can proxy them at /api/*
import { balance } from "../../../apps/services/payments/src/routes/balance.js";
import { ledger } from "../../../apps/services/payments/src/routes/ledger.js";
import { deposit } from "../../../apps/services/payments/src/routes/deposit.js";
import { rptGate } from "../../../apps/services/payments/src/middleware/rptGate.js";
import { payAtoRelease } from "../../../apps/services/payments/src/routes/payAto.js";
import { requireJwt } from "../../http/auth";
import { isRealMode } from "../../config/appMode";

const baseGuard = requireJwt({ roles: ["admin", "accountant"] });
const releaseGuard = (req: any, res: any, next: any) => {
  if (isRealMode()) {
    return requireJwt({ roles: ["admin", "accountant"], requireMfa: true })(req, res, next);
  }
  return baseGuard(req, res, next);
};

export const paymentsApi = Router();

// read-only
paymentsApi.get("/balance", balance);
paymentsApi.get("/ledger", ledger);

// write
paymentsApi.post("/deposit", deposit);
paymentsApi.post("/release", releaseGuard, rptGate, payAtoRelease);
