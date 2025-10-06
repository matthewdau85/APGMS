// src/api/payments.ts
import express from "express";
import { Payments } from "../../libs/paymentsClient"; // adjust if your libs path differs
import { AuthenticatedRequest, authenticate, requireRole } from "../http/auth";
import { getAppMode } from "../state/settings";
import { isMfaVerified } from "../security/mfa";
import { dualApprovals } from "../approvals/dual";

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
paymentsApi.post("/release", authenticate, requireRole("admin", "accountant"), async (req, res) => {
  try {
    const { abn, taxType, periodId, amountCents } = req.body || {};
    if (!abn || !taxType || !periodId || typeof amountCents !== "number") {
      return res.status(400).json({ error: "Missing fields" });
    }
    if (!Number.isFinite(amountCents)) {
      return res.status(400).json({ error: "Invalid amount" });
    }
    if (amountCents >= 0) {
      return res.status(400).json({ error: "Release must be negative" });
    }

    const authReq = req as AuthenticatedRequest;
    const user = authReq.user;
    if (!user) {
      return res.status(401).json({ error: "AUTH_REQUIRED" });
    }

    if (getAppMode() === "real" && (!user.mfa || !isMfaVerified(user.id))) {
      return res.status(403).json({ error: "MFA_REQUIRED" });
    }

    const approvalKey = [abn, taxType, periodId, Math.abs(amountCents)].join(":");
    const approval = dualApprovals.request(approvalKey, user.id, amountCents);
    if (!approval.granted) {
      return res.status(202).json({
        pending: true,
        approvals: approval.approvals,
        required: approval.required,
        message: approval.message,
      });
    }

    const data = await Payments.payAto({ abn, taxType, periodId, amountCents });
    res.json(data);
  } catch (err: any) {
    res.status(400).json({ error: err?.message || "Release failed" });
  }
});
