import { Router } from "express";
import { auth } from "../http/auth";
import { idempotency } from "../middleware/idempotency";
import { closeAndIssue, payAto, paytoSweep, settlementWebhook, evidence } from "../routes/reconcile";

export const api = Router();

const reconcile = Router();
const payMiddleware = [idempotency(), payAto] as const;

reconcile.post("/pay", ...payMiddleware);
reconcile.post("/close-issue", closeAndIssue);
reconcile.post("/settlement/webhook", settlementWebhook);

api.use("/reconcile", auth(["accountant", "admin"]), reconcile);

api.post("/pay", auth(["accountant", "admin"]), ...payMiddleware);
api.post("/close-issue", auth(["accountant", "admin"]), closeAndIssue);
api.post("/settlement/webhook", auth(["accountant", "admin"]), settlementWebhook);

const payto = Router();
payto.post("/sweep", paytoSweep);
api.use("/payto", auth(["accountant", "admin"]), payto);

const evidenceRouter = Router();
evidenceRouter.get("/", evidence);
api.use("/evidence", auth(["auditor", "accountant", "admin"]), evidenceRouter);
