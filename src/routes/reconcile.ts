import { Request, Response } from "express";
import pool from "../db/pool.js";
import { issueRPT } from "../rpt/issuer";
import { buildEvidenceBundle } from "../evidence/bundle";
import { releasePayment, resolveDestination } from "../rails/adapter";
import { debit as paytoDebit } from "../payto/adapter";
import { parseSettlementCSV } from "../settlement/splitParser";

export const SQL_SELECT_RPT_TOKEN_FOR_PAYMENT = `
  SELECT *
    FROM rpt_tokens
   WHERE abn = $1
     AND tax_type = $2
     AND period_id = $3
   ORDER BY id DESC
   LIMIT 1
`;

export const SQL_UPDATE_PERIOD_STATE_BY_KEY = `
  UPDATE periods
     SET state = $1
   WHERE abn = $2
     AND tax_type = $3
     AND period_id = $4
`;

export async function closeAndIssue(req: Request, res: Response) {
  const { abn, taxType, periodId, thresholds } = req.body;
  const thr =
    thresholds || {
      epsilon_cents: 50,
      variance_ratio: 0.25,
      dup_rate: 0.01,
      gap_minutes: 60,
      delta_vs_baseline: 0.2
    };
  const rpt = await issueRPT(abn, taxType, periodId, thr);
  return res.json(rpt);
}

export async function payAto(req: Request, res: Response) {
  const { abn, taxType, periodId, rail } = req.body;
  if (!abn || !taxType || !periodId || !rail) {
    return res.status(400).json({ error: "Missing abn/taxType/periodId/rail" });
  }
  const token = await pool.query(SQL_SELECT_RPT_TOKEN_FOR_PAYMENT, [abn, taxType, periodId]);
  if (token.rowCount === 0) {
    return res.status(400).json({ error: "NO_RPT" });
  }

  const payload = token.rows[0].payload;
  await resolveDestination(abn, rail, payload.reference);
  const r = await releasePayment(
    abn,
    taxType,
    periodId,
    Number(payload.amount_cents),
    rail,
    payload.reference,
    (req as any).requestId
  );
  await pool.query(SQL_UPDATE_PERIOD_STATE_BY_KEY, ["RELEASED", abn, taxType, periodId]);
  return res.json(r);
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
  const { abn, taxType, periodId } = req.query as Record<string, string>;
  const bundle = await buildEvidenceBundle(abn, taxType, periodId);
  res.json(bundle);
}
