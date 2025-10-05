import { Router } from "express";

import { idempotency } from "../middleware/idempotency";
import {
  closeAndIssue,
  payAto,
  paytoSweep,
  settlementWebhook,
  evidence,
} from "../routes/reconcile";
import { paymentsApi } from "./payments";

export const api = Router();

// Re-export sub-routers first so catch-all handlers don't shadow them
api.use("/", paymentsApi);

// Legacy handlers that historically lived on the app instance
api.post("/pay", idempotency(), payAto);
api.post("/close-issue", closeAndIssue);
api.post("/payto/sweep", paytoSweep);
api.post("/settlement/webhook", settlementWebhook);
api.get("/evidence", evidence);

export { paymentsApi };
