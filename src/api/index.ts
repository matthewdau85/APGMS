import { Router } from "express";

export const api = Router();

api.get("/status", (_req, res) => {
  res.json({ ok: true });
});
