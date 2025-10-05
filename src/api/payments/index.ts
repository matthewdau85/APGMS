// src/api/payments/index.ts
import { Router } from "express";
import { respondIfKillSwitch } from "../../safety/killSwitch";

// NOTE: these paths point to your payments service source under apps/services/payments
// We import the handlers directly so your main app can proxy them at /api/*
import { balance } from "../../../apps/services/payments/src/routes/balance.js";
import { ledger } from "../../../apps/services/payments/src/routes/ledger.js";
import { deposit } from "../../../apps/services/payments/src/routes/deposit.js";
import { rptGate } from "../../../apps/services/payments/src/middleware/rptGate.js";
import { payAtoRelease } from "../../../apps/services/payments/src/routes/payAto.js";

export const paymentsApi = Router();

// read-only
paymentsApi.get("/balance", balance);
paymentsApi.get("/ledger", ledger);

// write
paymentsApi.post("/deposit", deposit);
paymentsApi.post(
  "/release",
  (req, res, next) => {
    if (respondIfKillSwitch(res)) return;
    next();
  },
  rptGate,
  payAtoRelease
);
