// src/api/payments/index.ts
import { Router } from "express";

// NOTE: these paths point to your payments service source under apps/services/payments
// We import the handlers directly so your main app can proxy them at /api/*
import { balance } from "../../../apps/services/payments/src/routes/balance.js";
import { ledger } from "../../../apps/services/payments/src/routes/ledger.js";
import { deposit } from "../../../apps/services/payments/src/routes/deposit.js";
import { rptGate } from "../../../apps/services/payments/src/middleware/rptGate.js";
import { payAtoRelease } from "../../../apps/services/payments/src/routes/payAto.js";
import { verify as bankVerify, initiate as bankInitiate, manual as bankManual } from "../../../apps/services/payments/src/routes/bank.js";
import { report as stpReport } from "../../../apps/services/payments/src/routes/stp.js";

export const paymentsApi = Router();

// read-only
paymentsApi.get("/balance", balance);
paymentsApi.get("/ledger", ledger);

// write
paymentsApi.post("/deposit", deposit);
paymentsApi.post("/release", rptGate, payAtoRelease);
paymentsApi.post("/bank/verify", bankVerify);
paymentsApi.post("/bank/transfer", bankInitiate);
paymentsApi.post("/bank/manualTransfer", bankManual);
paymentsApi.post("/stp/report", stpReport);
