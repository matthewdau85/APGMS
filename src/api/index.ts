import { Router } from "express";
import { router as paytoRouter } from "../routes/payto";

export const api = Router();

api.use("/payto", paytoRouter);
