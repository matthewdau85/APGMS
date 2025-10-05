import { Router } from "express";
import { paymentsRouter } from "./payments";

export const api = Router();

api.use("/payments", paymentsRouter);
