import { Request, Response } from "express";
import { Pool } from "pg";

import { issueRPT } from "../rpt/issuer";
import { buildEvidenceBundle } from "../evidence/bundle";
import { releasePayment, resolveDestination } from "../rails/adapter";
import { debit as paytoDebit } from "../payto/adapter";
import { parseSettlementCSV } from "../settlement/splitParser";
import { appendAudit } from "../audit/appendOnly";
import { clearApprovals, ensureDualApproval } from "../recon/approvals";

const pool = new Pool();

export async function closeAndIssue(req: Request, res: Response) {
  const { abn, taxType, periodId, thresholds } = req.body || {};
  const user = req.user;
  if (!user) {
    return res.status(401).json({ error: "UNAUTHENTICATED" });
  }
  const thr =
    thresholds || { epsilon_cents: 50, variance_ratio: 0.25, dup_rate: 0.01, gap_minutes: 60, delta_vs_baseline: 0.2 };
  try {
    const rpt = await issueRPT(abn, taxType, periodId, thr);
    await appendAudit({
      actor: user.sub,
      action: "close",
      target: `${abn}:${taxType}:${periodId}`,
      payload: { thresholds: thr },
      requestId: req.requestId,
    });
    await appendAudit({
      actor: user.sub,
      action: "rpt",
      target: `${abn}:${taxType}:${periodId}`,
      payload: { amount_cents: rpt.payload.amount_cents, expires_at: rpt.payload.expiry_ts },
      requestId: req.requestId,
    });
    return res.json(rpt);
  } catch (e: any) {
    return res.status(400).json({ error: e?.message || "CLOSE_FAILED" });
  }
}

export async function payAto(req: Request, res: Response) {
  try {
    const { abn, taxType, periodId, rail } = req.body || {};
    const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : undefined;
    if (!abn || !taxType || !periodId || !rail) {
      return res.status(400).json({ error: "INVALID_RELEASE" });
    }
    const user = req.user;
    if (!user) {
      return res.status(401).json({ error: "UNAUTHENTICATED" });
    }
    const pr = await pool.query(
      "select * from rpt_tokens where abn= and tax_type= and period_id= order by id desc limit 1",
      [abn, taxType, periodId]
    );
    if (pr.rowCount === 0) return res.status(400).json({ error: "NO_RPT" });
    const payload = pr.rows[0].payload;
    const amount = Number(payload.amount_cents);
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ error: "INVALID_AMOUNT" });
    }

    await ensureDualApproval({
      abn,
      taxType,
      periodId,
      amountCents: amount,
      actorId: user.sub,
      actorRole: user.role,
      reason,
      requestId: req.requestId,
    });

    await resolveDestination(abn, rail, payload.reference);
    const result = await releasePayment(abn, taxType, periodId, amount, rail, payload.reference, {
      actor: user.sub,
      requestId: req.requestId,
    });
    await clearApprovals(abn, taxType, periodId);
    await pool.query("update periods set state='RELEASED' where abn= and tax_type= and period_id=", [abn, taxType, periodId]);
    await appendAudit({
      actor: user.sub,
      action: "receipt",
      target: `${abn}:${taxType}:${periodId}`,
      payload: { bank_receipt_hash: result.bank_receipt_hash, transfer_uuid: result.transfer_uuid },
      requestId: req.requestId,
    });
    return res.json(result);
  } catch (e: any) {
    const message = String(e?.message || "RELEASE_FAILED");
    const status = message === "DUAL_APPROVAL_REQUIRED" ? 403 : 400;
    return res.status(status).json({ error: message });
  }
}

export async function paytoSweep(req: Request, res: Response) {
  const { abn, amount_cents, reference } = req.body;
  const r = await paytoDebit(abn, amount_cents, reference);
  return res.json(r);
}

export async function settlementWebhook(req: Request, res: Response) {
  const csvText = req.body?.csv || "";
  const rows = parseSettlementCSV(csvText);
  return res.json({ ingested: rows.length });
}

export async function evidence(req: Request, res: Response) {
  const { abn, taxType, periodId } = req.query as any;
  const user = req.user;
  if (!user) {
    return res.status(401).json({ error: "UNAUTHENTICATED" });
  }
  const bundle = await buildEvidenceBundle(abn, taxType, periodId);
  await appendAudit({
    actor: user.sub,
    action: "evidence-export",
    target: `${abn}:${taxType}:${periodId}`,
    payload: { items: bundle?.owa_ledger_deltas?.length || 0 },
    requestId: req.requestId,
  });
  res.json(bundle);
}
