import express from "express";

import { idempotency } from "../middleware/idempotency";
import {
  closeAndIssue,
  payAto,
  paytoSweep,
  settlementWebhook,
  evidence,
} from "../routes/reconcile";

/**
 * Primary Express router for legacy gateway endpoints.
 *
 * These routes previously lived on the monolithic gateway server and are kept
 * together so they can be mounted behind `/api` from the main app bootstrap.
 */
export const api = express.Router();

// Legacy reconciliation + evidence endpoints
api.post("/pay", idempotency(), payAto);
api.post("/close-issue", closeAndIssue);
api.post("/payto/sweep", paytoSweep);
api.post("/settlement/webhook", settlementWebhook);
api.get("/evidence", evidence);

export default api;
