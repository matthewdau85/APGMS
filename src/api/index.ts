import { Router } from "express";
import { router as depositRouter } from "../routes/deposit";
import { router as balanceRouter } from "../routes/balance";
import { router as reconcileRouter } from "../routes/reconcile";
import { router as evidenceRouter } from "../routes/evidence";

export const api = Router();

api.use("/deposit", depositRouter);
api.use("/balance", balanceRouter);
api.use("/reconcile", reconcileRouter);
api.use("/evidence", evidenceRouter);
