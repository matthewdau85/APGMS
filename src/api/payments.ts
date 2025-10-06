// src/api/payments.ts
import express from "express";
import { Payments } from "../../libs/paymentsClient"; // adjust if your libs path differs
import { appendAudit } from "../audit/appendOnly";
import { requireMfa, requireRole } from "../auth/middleware";
import type { Role } from "../auth/types";
import { clearApprovals, ensureDualApproval } from "../recon/approvals";

export const paymentsApi = express.Router();

const VIEW_ROLES: Role[] = ["viewer", "operator", "approver", "admin"];

// GET /api/balance?abn=&taxType=&periodId=
paymentsApi.get("/balance", requireRole(VIEW_ROLES), async (req, res) => {
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
paymentsApi.get("/ledger", requireRole(VIEW_ROLES), async (req, res) => {
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
paymentsApi.post("/deposit", requireRole(["operator", "admin"]), requireMfa, async (req, res) => {
  try {
    const { abn, taxType, periodId, amountCents } = req.body || {};
    if (!abn || !taxType || !periodId || typeof amountCents !== "number") {
      return res.status(400).json({ error: "Missing fields" });
    }
    if (amountCents <= 0) {
      return res.status(400).json({ error: "Deposit must be positive" });
    }
    const data = await Payments.deposit({ abn, taxType, periodId, amountCents });
    await appendAudit({
      actor: req.user!.sub,
      action: "deposit",
      target: `${abn}:${taxType}:${periodId}`,
      payload: { amount_cents: amountCents },
      requestId: req.requestId,
    });
    res.json(data);
  } catch (err: any) {
    res.status(400).json({ error: err?.message || "Deposit failed" });
  }
});

// POST /api/release  (calls payAto)
paymentsApi.post("/release", requireRole(["operator", "admin"]), requireMfa, async (req, res) => {
  try {
    const { abn, taxType, periodId, amountCents } = req.body || {};
    const reasonText = typeof req.body?.reason === "string" ? req.body.reason.trim() : undefined;
    if (!abn || !taxType || !periodId || typeof amountCents !== "number") {
      return res.status(400).json({ error: "Missing fields" });
    }
    if (amountCents >= 0) {
      return res.status(400).json({ error: "Release must be negative" });
    }
    const releaseAmount = Math.abs(amountCents);
    await ensureDualApproval({
      abn,
      taxType,
      periodId,
      amountCents: releaseAmount,
      actorId: req.user!.sub,
      actorRole: req.user!.role,
      reason: reasonText,
      requestId: req.requestId,
    });
    const data = await Payments.payAto({ abn, taxType, periodId, amountCents });
    await appendAudit({
      actor: req.user!.sub,
      action: "release",
      target: `${abn}:${taxType}:${periodId}`,
      payload: { amount_cents: releaseAmount, reason: reasonText },
      requestId: req.requestId,
    });
    if (data?.bank_receipt_hash || data?.transfer_uuid) {
      await appendAudit({
        actor: req.user!.sub,
        action: "receipt",
        target: `${abn}:${taxType}:${periodId}`,
        payload: { bank_receipt_hash: data.bank_receipt_hash, transfer_uuid: data.transfer_uuid },
        requestId: req.requestId,
      });
    }
    await clearApprovals(abn, taxType, periodId);
    res.json(data);
  } catch (err: any) {
    const message = String(err?.message || "Release failed");
    const status = message === "DUAL_APPROVAL_REQUIRED" ? 403 : 400;
    res.status(status).json({ error: message });
  }
});
