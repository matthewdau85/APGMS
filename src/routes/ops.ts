import express from "express";
import { replayDlq } from "../ops/dlq";

export const opsRouter = express.Router();

opsRouter.post("/dlq/replay", async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
  const mfa = req.get("x-mfa-otp") ?? "";
  if (!/^[0-9]{6}$/.test(mfa)) {
    return res.status(401).json({ error: "MFA_REQUIRED" });
  }
  if (!ids.length) {
    return res.status(400).json({ error: "NO_IDS" });
  }
  if (ids.length > 25) {
    return res.status(429).json({ error: "BATCH_TOO_LARGE" });
  }
  const numericIds = ids.map((id: any) => Number(id)).filter((id: number) => Number.isFinite(id));
  if (!numericIds.length) {
    return res.status(400).json({ error: "INVALID_IDS" });
  }
  const outcomes = await replayDlq(numericIds);
  res.json({ outcomes });
});
