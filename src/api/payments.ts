// src/api/payments.ts
import express from "express";
import * as PaymentsClient from "../../libs/paymentsClient"; // adjust if your libs path differs
import { requireJwt, type AuthedRequest } from "../http/auth";
import { isRealMode } from "../config/appMode";
import * as approvals from "../approvals/dual";

export const paymentsApi = express.Router();

const baseGuard = requireJwt({ roles: ["admin", "accountant"] });
const releaseGuard = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (isRealMode()) {
    return requireJwt({ roles: ["admin", "accountant"], requireMfa: true })(req, res, next);
  }
  return baseGuard(req, res, next);
};

// GET /api/balance?abn=&taxType=&periodId=
paymentsApi.get("/balance", async (req, res) => {
  try {
    const { abn, taxType, periodId } = req.query as Record<string, string>;
    if (!abn || !taxType || !periodId) {
      return res.status(400).json({ error: "Missing abn/taxType/periodId" });
    }
    const data = await PaymentsClient.Payments.balance({ abn, taxType, periodId });
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
    const data = await PaymentsClient.Payments.ledger({ abn, taxType, periodId });
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
    const data = await PaymentsClient.Payments.deposit({ abn, taxType, periodId, amountCents });
    res.json(data);
  } catch (err: any) {
    res.status(400).json({ error: err?.message || "Deposit failed" });
  }
});

// POST /api/release  (calls payAto)
paymentsApi.post("/release", releaseGuard, async (req: AuthedRequest, res) => {
  try {
    const { abn, taxType, periodId, amountCents } = req.body || {};
    if (!abn || !taxType || !periodId || typeof amountCents !== "number") {
      return res.status(400).json({ error: "Missing fields" });
    }
    if (amountCents >= 0) {
      return res.status(400).json({ error: "Release must be negative" });
    }
    const actor = req.auth?.user || { id: "system", email: "system@apgms", role: "admin", mfa: true };
    if (isRealMode() && !req.auth?.user) {
      return res.status(403).json({ error: "MFA_REQUIRED" });
    }
    const approval = await approvals.recordReleaseApproval(
      { abn, taxType, periodId, amountCents, reference: req.body?.reference },
      actor
    );
    if (!approval.approved) {
      return res.status(403).json({ error: "AWAITING_SECOND_APPROVAL", approvals: approval.approvals ?? 0 });
    }
    const data = await PaymentsClient.Payments.payAto({ abn, taxType, periodId, amountCents });
    res.json(data);
  } catch (err: any) {
    console.error("release error", err);
    res.status(400).json({ error: err?.message || "Release failed" });
  }
});
