// src/api/payments.ts
import express from "express";
import { Payments } from "../../libs/paymentsClient"; // adjust if your libs path differs
import { sendError } from "../http/error";

export const paymentsApi = express.Router();

// GET /api/balance?abn=&taxType=&periodId=
paymentsApi.get("/balance", async (req, res) => {
  try {
    const { abn, taxType, periodId } = req.query as Record<string, string>;
    if (!abn || !taxType || !periodId) {
      return sendError(res, 400, "BadRequest", "Missing abn/taxType/periodId");
    }
    const data = await Payments.balance({ abn, taxType, periodId });
    res.json(data);
  } catch (err: any) {
    return sendError(res, 500, "BalanceFailed", err?.message || "Balance failed");
  }
});

// GET /api/ledger?abn=&taxType=&periodId=
paymentsApi.get("/ledger", async (req, res) => {
  try {
    const { abn, taxType, periodId } = req.query as Record<string, string>;
    if (!abn || !taxType || !periodId) {
      return sendError(res, 400, "BadRequest", "Missing abn/taxType/periodId");
    }
    const data = await Payments.ledger({ abn, taxType, periodId });
    res.json(data);
  } catch (err: any) {
    return sendError(res, 500, "LedgerFailed", err?.message || "Ledger failed");
  }
});

// POST /api/deposit
paymentsApi.post("/deposit", async (req, res) => {
  try {
    const { abn, taxType, periodId, amountCents } = req.body || {};
    if (!abn || !taxType || !periodId || typeof amountCents !== "number") {
      return sendError(res, 400, "BadRequest", "Missing fields");
    }
    if (amountCents <= 0) {
      return sendError(res, 400, "BadRequest", "Deposit must be positive");
    }
    const data = await Payments.deposit({ abn, taxType, periodId, amountCents });
    res.json(data);
  } catch (err: any) {
    return sendError(res, 400, "DepositFailed", err?.message || "Deposit failed");
  }
});

// POST /api/release  (calls payAto)
paymentsApi.post("/release", async (req, res) => {
  try {
    const { abn, taxType, periodId, amountCents } = req.body || {};
    if (!abn || !taxType || !periodId || typeof amountCents !== "number") {
      return sendError(res, 400, "BadRequest", "Missing fields");
    }
    if (amountCents >= 0) {
      return sendError(res, 400, "BadRequest", "Release must be negative");
    }
    const data = await Payments.payAto({ abn, taxType, periodId, amountCents });
    res.json(data);
  } catch (err: any) {
    return sendError(res, 400, "ReleaseFailed", err?.message || "Release failed");
  }
});
