import { Router } from "express";
import { deposit } from "../routes/deposit";

export const api = Router();

api.post("/deposit", deposit);
