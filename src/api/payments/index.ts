// src/api/payments/index.ts
import { Router } from "express";

// NOTE: these paths point to your payments service source under apps/services/payments
// We import the handlers directly so your main app can proxy them at /api/*
import { balance } from "../../../apps/services/payments/src/routes/balance.js";
import { ledger } from "../../../apps/services/payments/src/routes/ledger.js";
import { deposit } from "../../../apps/services/payments/src/routes/deposit.js";
import { rptGate } from "../../../apps/services/payments/src/middleware/rptGate.js";
import { release } from "../../../apps/services/payments/src/routes/release.js";
import { importSettlement } from "../../../apps/services/payments/src/routes/settlementImport.js";
import { simRailReconFile } from "../../../apps/services/payments/src/routes/simRail.js";
import { evidence } from "../../../apps/services/payments/src/routes/evidence.js";

export const paymentsApi = Router();

// read-only
paymentsApi.get("/balance", balance);
paymentsApi.get("/ledger", ledger);
paymentsApi.get("/sim/rail/recon-file", simRailReconFile);
paymentsApi.get("/evidence/:periodId", evidence);

// write
paymentsApi.post("/deposit", deposit);
paymentsApi.post("/release", rptGate, release);
paymentsApi.post("/settlement/import", importSettlement);
