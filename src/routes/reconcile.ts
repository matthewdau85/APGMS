import type { Request, Response } from "express";
import { issueRPT } from "../rpt/issuer";
import { buildEvidenceBundle } from "../evidence/bundle";
import { releasePayment, resolveDestination } from "../rails/adapter";
import { debit as paytoDebit } from "../payto/adapter";
import { parseSettlementCSV } from "../settlement/splitParser";
import { Pool } from "pg";
import { appendAudit } from "../audit/appendOnly";

const pool = new Pool();

export async function closeAndIssue(req: Request, res: Response) {
  const { abn, taxType, periodId, thresholds } = req.body;
  if (!req.auth) {
    return res.status(500).json({ error: "AUTH_CONTEXT_MISSING" });
  }
  const thr =
    thresholds ||
    { epsilon_cents: 50, variance_ratio: 0.25, dup_rate: 0.01, gap_minutes: 60, delta_vs_baseline: 0.2 };
  try {
    const rpt = await issueRPT(abn, taxType, periodId, thr, {
      actorId: req.auth.userId,
      actorRoles: req.auth.roles,
      requestId: req.requestId,
      requestIp: req.requestIp,
    });
    await appendAudit({
      actor: req.auth,
      action: "rpt.issue",
      resource: { abn, taxType, periodId },
      result: "success",
      metadata: { thresholds: thr },
      requestId: req.requestId,
      requestIp: req.requestIp,
    });
    return res.json(rpt);
  } catch (e: any) {
    await appendAudit({
      actor: req.auth,
      action: "rpt.issue",
      resource: { abn, taxType, periodId },
      result: "error",
      metadata: { detail: e?.message },
      requestId: req.requestId,
      requestIp: req.requestIp,
    });
    return res.status(400).json({ error: e.message });
  }
}

export async function payAto(req: Request, res: Response) {
  const { abn, taxType, periodId, rail } = req.body;
  if (!req.auth) {
    return res.status(500).json({ error: "AUTH_CONTEXT_MISSING" });
  }
  const pr = await pool.query(
    "select * from rpt_tokens where abn= and tax_type= and period_id= order by id desc limit 1",
    [abn, taxType, periodId],
  );
  if (pr.rowCount === 0) return res.status(400).json({ error: "NO_RPT" });
  const payload = pr.rows[0].payload;
  const issuedBy = pr.rows[0].issued_by as string | undefined;
  if (issuedBy && issuedBy === req.auth.userId) {
    await appendAudit({
      actor: req.auth,
      action: "rpt.release",
      resource: { abn, taxType, periodId },
      result: "blocked",
      metadata: { reason: "SOD_ENFORCED" },
      requestId: req.requestId,
      requestIp: req.requestIp,
    });
    return res.status(403).json({ error: "SOD_BLOCKED" });
  }
  try {
    await resolveDestination(abn, rail, payload.reference);
    const r = await releasePayment(
      abn,
      taxType,
      periodId,
      payload.amount_cents,
      rail,
      payload.reference,
      req.auth,
      req.requestId,
      req.requestIp,
    );
    await pool.query("update periods set state='RELEASED' where abn= and tax_type= and period_id=", [abn, taxType, periodId]);
    await appendAudit({
      actor: req.auth,
      action: "rpt.release",
      resource: { abn, taxType, periodId },
      result: "success",
      metadata: { rail, reference: payload.reference },
      requestId: req.requestId,
      requestIp: req.requestIp,
    });
    return res.json(r);
  } catch (e: any) {
    await appendAudit({
      actor: req.auth,
      action: "rpt.release",
      resource: { abn, taxType, periodId },
      result: "error",
      metadata: { detail: e?.message },
      requestId: req.requestId,
      requestIp: req.requestIp,
    });
    return res.status(400).json({ error: e.message });
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
  res.json(await buildEvidenceBundle(abn, taxType, periodId));
}
