import type { Request, Response } from "express";
import { issueRPT } from "../rpt/issuer";
import { buildEvidenceBundle } from "../evidence/bundle";
import { releasePayment, resolveDestination } from "../rails/adapter";
import { debit as paytoDebit } from "../payto/adapter";
import { parseSettlementCSV } from "../settlement/splitParser";
import { Pool } from "pg";

const pool = new Pool();

const DEFAULT_THRESHOLDS = {
  epsilon_cents: 50,
  variance_ratio: 0.25,
  dup_rate: 0.01,
  gap_minutes: 60,
  delta_vs_baseline: 0.2,
};

export async function closeAndIssue(req: Request, res: Response) {
  const { abn, taxType, periodId } = req.body || {};
  const thresholds = { ...DEFAULT_THRESHOLDS, ...(req.body?.thresholds ?? {}) };
  if (!abn || !taxType || !periodId) {
    return res.status(400).json({ error: "Missing abn/taxType/periodId" });
  }
  try {
    const totals = await pool.query(
      `SELECT COALESCE(SUM(CASE WHEN amount_cents > 0 THEN amount_cents ELSE 0 END),0) AS credited
         FROM owa_ledger
        WHERE abn=$1 AND tax_type=$2 AND period_id=$3`,
      [abn, taxType, periodId]
    );
    const credited = Number(totals.rows[0]?.credited ?? 0);

    await pool.query(
      `INSERT INTO periods(
         abn,tax_type,period_id,state,basis,accrued_cents,credited_to_owa_cents,final_liability_cents,anomaly_vector,thresholds)
       VALUES ($1,$2,$3,'CLOSING','ACCRUAL',0,$4,$4,'{}',$5::jsonb)
       ON CONFLICT (abn,tax_type,period_id)
       DO UPDATE SET
         state='CLOSING',
         credited_to_owa_cents=$4,
         final_liability_cents=$4,
         thresholds=$5::jsonb`,
      [abn, taxType, periodId, credited, JSON.stringify(thresholds)]
    );

    const rpt = await issueRPT(abn, taxType as "PAYGW" | "GST", periodId, thresholds);
    return res.json(rpt);
  } catch (e: any) {
    return res.status(400).json({ error: e?.message || String(e) });
  }
}

export async function payAto(req: Request, res: Response) {
  const { abn, taxType, periodId, rail } = req.body || {};
  if (!abn || !taxType || !periodId || !rail) {
    return res.status(400).json({ error: "Missing abn/taxType/periodId/rail" });
  }
  const pr = await pool.query(
    `SELECT payload FROM rpt_tokens WHERE abn=$1 AND tax_type=$2 AND period_id=$3 ORDER BY id DESC LIMIT 1`,
    [abn, taxType, periodId]
  );
  if (pr.rowCount === 0) return res.status(400).json({ error: "NO_RPT" });
  const payload = pr.rows[0].payload;
  try {
    await resolveDestination(abn, rail, payload.reference);
    const r = await releasePayment(abn, taxType, periodId, payload.amount_cents, rail, payload.reference);
    await pool.query(
      `UPDATE periods SET state='RELEASED' WHERE abn=$1 AND tax_type=$2 AND period_id=$3`,
      [abn, taxType, periodId]
    );
    return res.json(r);
  } catch (e: any) {
    return res.status(400).json({ error: e?.message || String(e) });
  }
}

export async function paytoSweep(req: Request, res: Response) {
  const { abn, amount_cents, reference } = req.body || {};
  const result = await paytoDebit(abn, amount_cents, reference);
  return res.json(result);
}

export async function settlementWebhook(req: Request, res: Response) {
  const csvText = req.body?.csv || "";
  const rows = parseSettlementCSV(csvText);
  // TODO: For each row, post GST and NET into your ledgers, maintain txn_id reversal map
  return res.json({ ingested: rows.length });
}

export async function evidence(req: Request, res: Response) {
  const { abn, taxType, periodId } = req.query as any;
  res.json(await buildEvidenceBundle(abn, taxType, periodId));
}
