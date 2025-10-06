// src/api/payments/index.ts
import { Router } from "express";

// NOTE: these paths point to your payments service source under apps/services/payments
// We import the handlers directly so your main app can proxy them at /api/*
import { balance } from "../../../apps/services/payments/src/routes/balance.js";
import { ledger } from "../../../apps/services/payments/src/routes/ledger.js";
import { deposit } from "../../../apps/services/payments/src/routes/deposit.js";
import { rptGate } from "../../../apps/services/payments/src/middleware/rptGate.js";
import { release } from "../../../apps/services/payments/src/routes/release.js";

export const paymentsApi = Router();

// read-only
paymentsApi.get("/balance", balance);
paymentsApi.get("/ledger", ledger);

// write
paymentsApi.post("/deposit", deposit);
paymentsApi.post("/release", rptGate, release);
