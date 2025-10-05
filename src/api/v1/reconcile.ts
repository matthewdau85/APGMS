import { Router } from "express";
import { idempotency } from "../../middleware/idempotency";
import {
  closeAndIssue,
  payAto,
  paytoSweep,
} from "../../routes/reconcile";

export const reconcileRouter = Router();

reconcileRouter.post("/pay", idempotency(), payAto);
reconcileRouter.post("/close-issue", closeAndIssue);
reconcileRouter.post("/payto/sweep", paytoSweep);
