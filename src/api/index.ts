import { Router } from "express";
import { router as settlementRouter } from "../routes/settlement";

export const api = Router();

api.use("/settlement", settlementRouter);
