import { issueRPT } from "../rpt/issuer";
import { buildEvidenceBundle } from "../evidence/bundle";
import * as rails from "../rails/adapter";
import * as payto from "../payto/adapter";
import { parseSettlementCSV } from "../settlement/splitParser";
import { Pool } from "pg";
import type { AuthedRequest } from "../http/auth";
import { recordReleaseApproval } from "../approvals/dual";
import { isRealMode } from "../config/appMode";

const pool = new Pool();

export async function closeAndIssue(req: any, res: any) {
  const { abn, taxType, periodId, thresholds } = req.body;
  const thr =
    thresholds || { epsilon_cents: 50, variance_ratio: 0.25, dup_rate: 0.01, gap_minutes: 60, delta_vs_baseline: 0.2 };
  try {
    const rpt = await issueRPT(abn, taxType, periodId, thr);
    return res.json(rpt);
  } catch (e: any) {
    return res.status(400).json({ error: e.message });
  }
}

export async function payAto(req: AuthedRequest, res: any) {
  const { abn, taxType, periodId, rail } = req.body; // EFT|BPAY
  const pr = await pool.query(
    "select * from rpt_tokens where abn= and tax_type= and period_id= order by id desc limit 1",
    [abn, taxType, periodId]
  );
  if (pr.rowCount === 0) return res.status(400).json({ error: "NO_RPT" });
  const payload = pr.rows[0].payload;
  try {
    const actor = req.auth?.user || { id: "system", email: "system@apgms", role: "admin", mfa: true };
    if (isRealMode() && !req.auth?.user) {
      return res.status(401).json({ error: "UNAUTHENTICATED" });
    }
    const approval = await recordReleaseApproval(
      {
        abn,
        taxType,
        periodId,
        amountCents: Number(payload.amount_cents),
        reference: payload.reference
      },
      actor
    );
    if (!approval.approved) {
      return res
        .status(403)
        .json({ error: "AWAITING_SECOND_APPROVAL", approvals: approval.approvals ?? 0, requestId: approval.requestId });
    }
    await rails.resolveDestination(abn, rail, payload.reference);
    const r = await rails.releasePayment(abn, taxType, periodId, payload.amount_cents, rail, payload.reference);
    await pool.query("update periods set state='RELEASED' where abn= and tax_type= and period_id=", [abn, taxType, periodId]);
    return res.json(r);
  } catch (e: any) {
    return res.status(400).json({ error: e.message });
  }
}

export async function paytoSweep(req: any, res: any) {
  const { abn, amount_cents, reference } = req.body;
  const r = await payto.debit(abn, amount_cents, reference);
  return res.json(r);
}

export async function settlementWebhook(req: any, res: any) {
  const csvText = req.body?.csv || "";
  const rows = parseSettlementCSV(csvText);
  return res.json({ ingested: rows.length });
}

export async function evidence(req: any, res: any) {
  const { abn, taxType, periodId } = req.query as any;
  res.json(await buildEvidenceBundle(abn, taxType, periodId));
}
