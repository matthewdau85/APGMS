import { Router } from "express";
import { Pool } from "pg";
import { appendAudit } from "../audit/appendOnly";
import { requireMfa, requireRole } from "../auth/middleware";
import type { Role } from "../auth/types";
import { recordApproval } from "../recon/approvals";

const pool = new Pool();

export const api = Router();

api.post(
  "/releases/approve",
  requireRole(["operator", "approver", "admin"]),
  requireMfa,
  async (req, res) => {
    try {
      const user = req.user!;
      const { abn, taxType, periodId, reason } = req.body || {};
      if (!abn || !taxType || !periodId || typeof reason !== "string" || !reason.trim()) {
        return res.status(400).json({ error: "INVALID_APPROVAL" });
      }
      const { rows } = await pool.query(
        `SELECT final_liability_cents FROM periods WHERE abn=$1 AND tax_type=$2 AND period_id=$3`,
        [abn, taxType, periodId]
      );
      if (!rows.length) {
        return res.status(404).json({ error: "PERIOD_NOT_FOUND" });
      }
      const amount = Number(rows[0].final_liability_cents);
      await recordApproval({
        abn,
        taxType,
        periodId,
        amountCents: amount,
        userId: user.sub,
        userRole: user.role === "admin" ? "approver" : (user.role as Role),
        reason: reason.trim(),
        requestId: req.requestId,
      });
      await appendAudit({
        actor: user.sub,
        action: "approve",
        target: `${abn}:${taxType}:${periodId}`,
        payload: { amount_cents: amount, reason: reason.trim(), role: user.role },
        requestId: req.requestId,
      });
      return res.json({ ok: true });
    } catch (err: any) {
      return res.status(400).json({ error: err?.message || "APPROVAL_FAILED" });
    }
  }
);

api.post(
  "/allow-list",
  requireRole(["admin"]),
  requireMfa,
  async (req, res) => {
    try {
      const { abn, label, rail, reference, accountBsb, accountNumber } = req.body || {};
      if (!abn || !label || !rail || !reference) {
        return res.status(400).json({ error: "INVALID_ALLOW_LIST" });
      }
      await pool.query(
        `INSERT INTO remittance_destinations (abn,label,rail,reference,account_bsb,account_number)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (abn, rail, reference) DO UPDATE
           SET label=EXCLUDED.label,
               account_bsb=EXCLUDED.account_bsb,
               account_number=EXCLUDED.account_number`,
        [abn, label, rail, reference, accountBsb ?? null, accountNumber ?? null]
      );
      await appendAudit({
        actor: req.user!.sub,
        action: "allow-list",
        target: `${abn}:${rail}:${reference}`,
        payload: { label, accountBsb, accountNumber },
        requestId: req.requestId,
      });
      return res.json({ ok: true });
    } catch (err: any) {
      return res.status(400).json({ error: err?.message || "ALLOW_LIST_FAILED" });
    }
  }
);

api.delete(
  "/allow-list",
  requireRole(["admin"]),
  requireMfa,
  async (req, res) => {
    try {
      const { abn, rail, reference } = req.body || {};
      if (!abn || !rail || !reference) {
        return res.status(400).json({ error: "INVALID_ALLOW_LIST" });
      }
      await pool.query(`DELETE FROM remittance_destinations WHERE abn=$1 AND rail=$2 AND reference=$3`, [abn, rail, reference]);
      await appendAudit({
        actor: req.user!.sub,
        action: "allow-list-remove",
        target: `${abn}:${rail}:${reference}`,
        requestId: req.requestId,
      });
      return res.json({ ok: true });
    } catch (err: any) {
      return res.status(400).json({ error: err?.message || "ALLOW_LIST_FAILED" });
    }
  }
);
