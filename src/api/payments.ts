// src/api/payments.ts
import express from "express";
import { Payments } from "../../libs/paymentsClient"; // adjust if your libs path differs
import { authenticate } from "../http/auth";
import { hasRecentVerification } from "../security/mfa";
import { enforceDualApproval } from "../approvals/dual";
import { getAppMode } from "../security/state";

export const paymentsApi = express.Router();

const RELEASE_THRESHOLD = Number(process.env.RELEASE_DUAL_APPROVAL_THRESHOLD_CENTS || 100_000);

function ensureRealModeMfa(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (getAppMode() !== "real") {
    return next();
  }
  const auth = res.locals.auth;
  if (!auth) {
    return res.status(401).json({ error: "AUTH_REQUIRED" });
  }
  if (!hasRecentVerification(auth.userId)) {
    return res.status(403).json({ error: "MFA_REQUIRED" });
  }
  auth.mfaVerified = true;
  return next();
}

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
paymentsApi.post("/release", authenticate({ roles: ["admin", "accountant"] }), ensureRealModeMfa, async (req, res) => {
  try {
    const { abn, taxType, periodId, amountCents } = req.body || {};
    if (!abn || !taxType || !periodId || typeof amountCents !== "number") {
      return res.status(400).json({ error: "Missing fields" });
    }
    if (amountCents >= 0) {
      return res.status(400).json({ error: "Release must be negative" });
    }
    const auth = res.locals.auth;
    if (!auth) {
      return res.status(401).json({ error: "AUTH_REQUIRED" });
    }
    const approvalKey = `${abn}:${taxType}:${periodId}:${Math.abs(amountCents)}`;
    const approval = enforceDualApproval({
      key: approvalKey,
      userId: auth.userId,
      amountCents: Math.abs(amountCents),
      thresholdCents: RELEASE_THRESHOLD,
    });
    if (!approval.allowed) {
      return res.status(403).json({ error: "SECOND_APPROVER_REQUIRED", approver: approval.firstApprover });
    }
    const data = await Payments.payAto({ abn, taxType, periodId, amountCents });
    res.json(data);
  } catch (err: any) {
    res.status(400).json({ error: err?.message || "Release failed" });
  }
});
