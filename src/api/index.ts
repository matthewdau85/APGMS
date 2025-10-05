import { Router } from "express";
import { closeAndIssue, payAto, paytoSweep, settlementWebhook, evidence } from "../routes/reconcile";
import { router as paytoRouter } from "../routes/payto";
import { router as settlementRouter } from "../routes/settlement";

export const api = Router();

api.post("/close-issue", closeAndIssue);
api.post("/pay", payAto);
api.post("/payto/sweep", paytoSweep);
api.post("/settlement/webhook", settlementWebhook);
api.get("/evidence", evidence);

api.use("/payto", paytoRouter);
api.use("/settlement", settlementRouter);
