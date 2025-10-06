import { Router } from "express";
import { proofsRouter } from "./ops/proofs";

export const api = Router();

api.use("/ops/compliance/proofs", proofsRouter);
