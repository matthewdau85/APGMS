// server/api/payments.ts
import express from "express";
import { Payments } from "../../libs/paymentsClient"; // adjust path
import { MoneyCents, expectMoneyCents, toCents } from "../../libs/money";

export const router = express.Router();

router.post("/deposit", async (req, res) => {
  try {
    const { abn, taxType, periodId, amountCents } = req.body;
    if (!abn || !taxType || !periodId) {
      return res.status(400).json({ error: "Missing fields" });
    }
    let cents: MoneyCents;
    try {
      cents = expectMoneyCents(amountCents, "amountCents");
    } catch (err: any) {
      return res.status(400).json({ error: err?.message || "Invalid amount" });
    }
    if (toCents(cents) <= 0) {
      return res.status(400).json({ error: "Deposit must be positive" });
    }
    const result = await Payments.deposit({ abn, taxType, periodId, amountCents: cents });
    res.json(result);
  } catch (err: any) {
    // Payments client throws Error with message from the service on 4xx
    res.status(400).json({ error: err.message || "Deposit failed" });
  }
});

router.post("/release", async (req, res) => {
  try {
    const { abn, taxType, periodId, amountCents } = req.body;
    if (!abn || !taxType || !periodId) {
      return res.status(400).json({ error: "Missing fields" });
    }
    let cents: MoneyCents;
    try {
      cents = expectMoneyCents(amountCents, "amountCents");
    } catch (err: any) {
      return res.status(400).json({ error: err?.message || "Invalid amount" });
    }
    if (toCents(cents) >= 0) {
      return res.status(400).json({ error: "Release must be negative" });
    }
    const result = await Payments.payAto({ abn, taxType, periodId, amountCents: cents });
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message || "Release failed" });
  }
});
