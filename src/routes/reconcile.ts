import { Request, Response } from "express";
import { issueRPT } from "../rpt/issuer";
import { buildEvidenceBundle } from "../evidence/bundle";
import { releasePayment, resolveDestination } from "../rails/adapter";
import { debit as paytoDebit } from "../payto/adapter";
import { parseSettlementCSV } from "../settlement/splitParser";
import { pool } from "../db/pool";
import { appendAudit } from "../audit/appendOnly";
import { AuthenticatedUser } from "../auth/types";

export async function closeAndIssue(req: Request, res: Response) {
  const { abn, taxType, periodId, thresholds } = req.body || {};
  if (!abn || !taxType || !periodId) {
    return res.status(400).json({ error: "Missing abn/taxType/periodId" });
  }
  const thr =
    thresholds || {
      epsilon_cents: 50,
      variance_ratio: 0.25,
      dup_rate: 0.01,
      gap_minutes: 60,
      delta_vs_baseline: 0.2,
    };
  const actor = req.user as AuthenticatedUser | undefined;
  try {
    await appendAudit({
      actorId: actor?.sub,
      action: "close",
      targetType: "period",
      targetId: `${abn}:${taxType}:${periodId}`,
      payload: { thresholds: thr },
    });
    const rpt = await issueRPT(abn, taxType, periodId, thr);
    await appendAudit({
      actorId: actor?.sub,
      action: "rpt_issue",
      targetType: "period",
      targetId: `${abn}:${taxType}:${periodId}`,
      payload: { nonce: rpt.payload?.nonce, expiry: rpt.payload?.expiry_ts, rptId: rpt.rptId },
    });
    return res.json(rpt);
  } catch (e: any) {
    await appendAudit({
      actorId: actor?.sub,
      action: "rpt_issue_failed",
      targetType: "period",
      targetId: `${abn}:${taxType}:${periodId}`,
      payload: { error: String(e?.message || e) },
    });
    return res.status(400).json({ error: e.message || String(e) });
  }
}

export async function payAto(req: Request, res: Response) {
  const { abn, taxType, periodId, rail } = req.body || {};
  if (!abn || !taxType || !periodId || !rail) {
    return res.status(400).json({ error: "Missing fields" });
  }
  const actor = req.user as AuthenticatedUser | undefined;
  const targetId = `${abn}:${taxType}:${periodId}`;
  await appendAudit({
    actorId: actor?.sub,
    action: "release_attempt",
    targetType: "period",
    targetId,
    payload: { abn, taxType, periodId, rail },
  });

  const pr = await pool.query(
    "select * from rpt_tokens where abn= and tax_type= and period_id= order by id desc limit 1",
    [abn, taxType, periodId]
  );
  if (pr.rowCount === 0) {
    await appendAudit({
      actorId: actor?.sub,
      action: "release_blocked",
      targetType: "period",
      targetId,
      payload: { reason: "NO_RPT" },
    });
    return res.status(400).json({ error: "NO_RPT" });
  }
  const payload = pr.rows[0].payload;
  try {
    await resolveDestination(abn, rail, payload.reference);
    const r = await releasePayment(
      abn,
      taxType,
      periodId,
      payload.amount_cents,
      rail,
      payload.reference,
      actor?.sub
    );
    await pool.query("update periods set state='RELEASED' where abn= and tax_type= and period_id=", [abn, taxType, periodId]);
    return res.json(r);
  } catch (e: any) {
    await appendAudit({
      actorId: actor?.sub,
      action: "release_failed",
      targetType: "period",
      targetId,
      payload: { error: String(e?.message || e) },
    });
    return res.status(400).json({ error: e.message || String(e) });
  }
}

export async function paytoSweep(req: Request, res: Response) {
  const { abn, amount_cents, reference } = req.body || {};
  const r = await paytoDebit(abn, amount_cents, reference);
  return res.json(r);
}

export async function settlementWebhook(req: Request, res: Response) {
  const csvText = req.body?.csv || "";
  const rows = parseSettlementCSV(csvText);
  // TODO: For each row, post GST and NET into your ledgers, maintain txn_id reversal map
  return res.json({ ingested: rows.length });
}

export async function evidence(req: Request, res: Response) {
  const { abn, taxType, periodId } = req.query as Record<string, string>;
  if (!abn || !taxType || !periodId) {
    return res.status(400).json({ error: "Missing abn/taxType/periodId" });
  }
  const bundle = await buildEvidenceBundle(abn, taxType, periodId);
  await appendAudit({
    actorId: (req.user as AuthenticatedUser | undefined)?.sub,
    action: "evidence_export",
    targetType: "period",
    targetId: `${abn}:${taxType}:${periodId}`,
    payload: { size: Array.isArray((bundle as any)?.owa_ledger_deltas) ? (bundle as any).owa_ledger_deltas.length : undefined },
  });
  res.json(bundle);
}
