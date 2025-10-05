import { Router } from "express";
import { settlementWebhook } from "../../routes/reconcile";

export const settlementRouter = Router();

settlementRouter.post("/webhook", settlementWebhook);
