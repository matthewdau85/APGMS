import { Router } from "express";

import { idempotency } from "../middleware/idempotency";
import {
  closeAndIssue,
  evidence,
  payAto,
  paytoSweep,
  settlementWebhook
} from "../routes/reconcile";

export const api = Router();

api.post("/pay", idempotency(), payAto);
api.post("/close-issue", closeAndIssue);
api.post("/payto/sweep", paytoSweep);
api.post("/settlement/webhook", settlementWebhook);
api.get("/evidence", evidence);

export {
  closeAndIssue,
  evidence,
  payAto,
  paytoSweep,
  settlementWebhook
};

export default api;
