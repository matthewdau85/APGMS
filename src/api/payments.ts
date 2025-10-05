// src/api/payments.ts
import { Router } from "express";

import { balance } from "../../apps/services/payments/src/routes/balance.js";
import { ledger } from "../../apps/services/payments/src/routes/ledger.js";
import { deposit } from "../../apps/services/payments/src/routes/deposit.js";
import { rptGate } from "../../apps/services/payments/src/middleware/rptGate.js";
import { payAtoRelease } from "../../apps/services/payments/src/routes/payAto.js";

export const paymentsApi = Router();

paymentsApi.get("/balance", balance);
paymentsApi.get("/ledger", ledger);
paymentsApi.post("/deposit", deposit);
paymentsApi.post("/release", rptGate, payAtoRelease);
