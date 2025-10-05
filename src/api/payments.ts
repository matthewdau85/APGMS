import { Router } from "express";

export const paymentsApi = Router();

paymentsApi.get("/health", (_req, res) => res.json({ ok: true }));
