// src/api/payments.ts
import express from "express";
import { Payments } from "../../libs/paymentsClient"; // adjust if your libs path differs

export const paymentsApi = express.Router();

// GET /api/balance?abn=&taxType=&periodId=
paymentsApi.get("/balance", async (req, res) => {
  try {
    const { abn, taxType, periodId } = req.query as Record<string, string>;
    if (!abn || !taxType || !periodId) {
      return res.status(400).json({ error: "Missing abn/taxType/periodId" });
    }
    const data = await Payments.balance({ abn, taxType, periodId });
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "Balance failed" });
  }
});

// GET /api/ledger?abn=&taxType=&periodId=
paymentsApi.get("/ledger", async (req, res) => {
  try {
    const { abn, taxType, periodId } = req.query as Record<string, string>;
    if (!abn || !taxType || !periodId) {
      return res.status(400).json({ error: "Missing abn/taxType/periodId" });
    }
    const data = await Payments.ledger({ abn, taxType, periodId });
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "Ledger failed" });
  }
});

// POST /api/deposit
paymentsApi.post("/deposit", async (req, res) => {
  try {
    const { abn, taxType, periodId, amountCents } = req.body || {};
    if (!abn || !taxType || !periodId || typeof amountCents !== "number") {
      return res.status(400).json({ error: "Missing fields" });
    }
    if (amountCents <= 0) {
      return res.status(400).json({ error: "Deposit must be positive" });
    }
    const data = await Payments.deposit({ abn, taxType, periodId, amountCents });
    res.json(data);
  } catch (err: any) {
    res.status(400).json({ error: err?.message || "Deposit failed" });
  }
});

// POST /api/release  (calls payAto)
paymentsApi.post("/release", async (req, res) => {
  try {
    const { abn, taxType, periodId, amountCents } = req.body || {};
    if (!abn || !taxType || !periodId || typeof amountCents !== "number") {
      return res.status(400).json({ error: "Missing fields" });
    }
    if (amountCents >= 0) {
      return res.status(400).json({ error: "Release must be negative" });
    }
    const data = await Payments.payAto({ abn, taxType, periodId, amountCents });
    res.json(data);
  } catch (err: any) {
    res.status(400).json({ error: err?.message || "Release failed" });
  }
});
