import { Router } from "express";
import { evidence as evidenceHandler } from "../../routes/reconcile";

export const evidenceRouter = Router();

evidenceRouter.get("/", evidenceHandler);
