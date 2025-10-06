import { Request, Response } from "express";
import { issueRPT } from "../rpt/issuer";
import { buildEvidenceBundle } from "../evidence/bundle";
import { releasePayment, resolveDestination } from "../rails/adapter";
import { debit as paytoDebit } from "../payto/adapter";
import { parseSettlementCSV } from "../settlement/splitParser";
import { pool } from "../db/pool";
import {
  selectLatestRptToken,
  updatePeriodStateByKey,
} from "../db/queries";

type CloseIssueBody = {
  abn: string;
  taxType: string;
  periodId: string;
  thresholds?: Record<string, number>;
};

type PayAtoBody = {
  abn: string;
  taxType: string;
  periodId: string;
  rail: "EFT" | "BPAY";
};

type EvidenceQuery = {
  abn: string;
  taxType: string;
  periodId: string;
};

export async function closeAndIssue(req: Request<unknown, unknown, CloseIssueBody>, res: Response) {
  const { abn, taxType, periodId, thresholds } = req.body;
  const thr = thresholds || {
    epsilon_cents: 50,
    variance_ratio: 0.25,
    dup_rate: 0.01,
    gap_minutes: 60,
    delta_vs_baseline: 0.2,
  };
  try {
    const rpt = await issueRPT(abn, taxType as "PAYGW" | "GST", periodId, thr);
    return res.json(rpt);
  } catch (e: any) {
    return res.status(400).json({ error: e.message });
  }
}

export async function payAto(req: Request<unknown, unknown, PayAtoBody>, res: Response) {
  const { abn, taxType, periodId, rail } = req.body;
  const pr = await pool.query(selectLatestRptToken(abn, taxType, periodId));
  if (pr.rowCount === 0) return res.status(400).json({ error: "NO_RPT" });
  const payload = pr.rows[0].payload;
  try {
    await resolveDestination(abn, rail, payload.reference);
    const r = await releasePayment(abn, taxType, periodId, payload.amount_cents, rail, payload.reference);
    await pool.query(updatePeriodStateByKey(abn, taxType, periodId, "RELEASED"));
    return res.json(r);
  } catch (e: any) {
    return res.status(400).json({ error: e.message });
  }
}

export async function paytoSweep(req: Request, res: Response) {
  const { abn, amount_cents, reference } = req.body as any;
  const r = await paytoDebit(abn, amount_cents, reference);
  return res.json(r);
}

export async function settlementWebhook(req: Request, res: Response) {
  const csvText = (req.body as any)?.csv || "";
  const rows = parseSettlementCSV(csvText);
  return res.json({ ingested: rows.length });
}

export async function evidence(req: Request<unknown, unknown, unknown, EvidenceQuery>, res: Response) {
  const { abn, taxType, periodId } = req.query as EvidenceQuery;
  res.json(await buildEvidenceBundle(abn, taxType, periodId));
}
