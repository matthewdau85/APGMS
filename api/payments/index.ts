import { Router } from "express";

export const paymentsRouter = Router();

paymentsRouter.get("/health", (_req, res) => res.json({ ok: true }));
// Re-export or mount existing payments endpoints here as needed
