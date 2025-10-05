import { Router } from "express";
import { auth } from "../../http/auth";
import { reconcileRouter } from "./reconcile";
import { evidenceRouter } from "./evidence";
import { settlementRouter } from "./settlement";

export const v1 = Router();

v1.use("/reconcile", auth(["accountant", "admin"]), reconcileRouter);
v1.use(
  "/evidence",
  auth(["auditor", "accountant", "admin"]),
  evidenceRouter
);
v1.use("/settlement", auth(["accountant", "admin"]), settlementRouter);

export { reconcileRouter, evidenceRouter, settlementRouter };
