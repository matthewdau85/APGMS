// server/api/payments.ts
import express from "express";
import { Payments } from "../../libs/paymentsClient"; // adjust path

export const router = express.Router();

router.post("/deposit", async (req, res) => {
  try {
    const { abn, taxType, periodId, amountCents } = req.body;
    if (!abn || !taxType || !periodId || typeof amountCents !== "number") {
      return res.status(400).json({ error: "Missing fields" });
    }
    if (amountCents <= 0) {
      return res.status(400).json({ error: "Deposit must be positive" });
    }
    const result = await Payments.deposit({ abn, taxType, periodId, amountCents });
    res.json(result);
  } catch (err: any) {
    // Payments client throws Error with message from the service on 4xx
    res.status(400).json({ error: err.message || "Deposit failed" });
  }
});

router.post("/release", async (req, res) => {
  try {
    const { abn, taxType, periodId, amountCents, destination } = req.body;
    if (!abn || !taxType || !periodId || typeof amountCents !== "number" || !destination) {
      return res.status(400).json({ error: "Missing fields" });
    }
    if (amountCents >= 0) {
      return res.status(400).json({ error: "Release must be negative" });
    }
    const idempotencyKey = req.get("Idempotency-Key") || undefined;
    const result = await Payments.release({ abn, taxType, periodId, amountCents, destination, idempotencyKey });
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message || "Release failed" });
  }
});
