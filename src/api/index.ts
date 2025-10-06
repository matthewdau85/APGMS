import express from "express";

export const api = express.Router();

api.get("/status", (_req, res) => {
  res.json({ ok: true });
});
