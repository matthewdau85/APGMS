import { Request, Response } from "express";
import { Pool } from "pg";
import { issueRPT } from "../rpt/issuer";
import { buildEvidenceBundle } from "../evidence/bundle";
import { releasePayment, resolveDestination } from "../rails/adapter";
import { debit as paytoDebit } from "../payto/adapter";
import { parseSettlementCSV } from "../settlement/splitParser";
import { deriveTotals } from "../rpt/utils";

const pool = new Pool();

function rptEnabled(): boolean {
  return process.env.PROTO_ENABLE_RPT === "true";
}

export async function closeAndIssue(req: Request, res: Response) {
  if (!rptEnabled()) {
    return res.status(403).json({ error: "RPT_DISABLED" });
  }
  const { abn, taxType, periodId, thresholds } = req.body as {
    abn: string;
    taxType: "PAYGW" | "GST";
    periodId: string;
    thresholds?: Record<string, number>;
  };
  if (!abn || !taxType || !periodId) {
    return res.status(400).json({ error: "MISSING_FIELDS" });
  }
  const thr =
    thresholds || { epsilon_cents: 50, variance_ratio: 0.25, dup_rate: 0.01, gap_minutes: 60, delta_vs_baseline: 0.2 };
  try {
    const rpt = await issueRPT(abn, taxType, periodId, thr);
    return res.json(rpt);
  } catch (e: any) {
    return res.status(400).json({ error: e.message });
  }
}

export async function payAto(req: Request, res: Response) {
  if (!rptEnabled()) {
    return res.status(403).json({ error: "RPT_DISABLED" });
  }
  const { abn, taxType, periodId, rail } = req.body as {
    abn: string;
    taxType: "PAYGW" | "GST";
    periodId: string;
    rail: "EFT" | "BPAY";
  };
  if (!abn || !taxType || !periodId || !rail) {
    return res.status(400).json({ error: "MISSING_FIELDS" });
  }
  try {
    const { payload } = res.locals.rpt ?? {};
    if (!payload) {
      return res.status(401).json({ error: "RPT_REQUIRED" });
    }
    const { rows } = await pool.query(
      "select final_liability_cents from periods where abn = $1 and tax_type = $2 and period_id = $3",
      [abn, taxType, periodId]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: "PERIOD_NOT_FOUND" });
    }
    const totals = deriveTotals(taxType, Number(rows[0].final_liability_cents || 0));
    const cents = taxType === "PAYGW" ? totals.paygw_cents : totals.gst_cents;
    const reference = process.env.ATO_PRN || payload.rpt_id;
    await resolveDestination(abn, rail, reference);
    const release = await releasePayment(abn, taxType, periodId, cents, rail, reference);
    await pool.query(
      "update periods set state = 'RELEASED' where abn = $1 and tax_type = $2 and period_id = $3",
      [abn, taxType, periodId]
    );
    return res.json(release);
  } catch (e: any) {
    return res.status(400).json({ error: e.message });
  }
}

export async function paytoSweep(req: Request, res: Response) {
  const { abn, amount_cents, reference } = req.body as { abn: string; amount_cents: number; reference: string };
  const r = await paytoDebit(abn, amount_cents, reference);
  return res.json(r);
}

export async function settlementWebhook(req: Request, res: Response) {
  const csvText = (req.body as { csv?: string })?.csv || "";
  const rows = parseSettlementCSV(csvText);
  return res.json({ ingested: rows.length });
}

export async function evidence(req: Request, res: Response) {
  const { abn, taxType, periodId } = req.query as { abn: string; taxType: string; periodId: string };
  res.json(await buildEvidenceBundle(abn, taxType, periodId));
}
