import { issueRPT } from "../rpt/issuer";
import { buildEvidenceBundle } from "../evidence/bundle";
import { releasePayment, resolveDestination } from "../rails/adapter";
import { debit as paytoDebit } from "../payto/adapter";
import { parseSettlementCSV } from "../settlement/splitParser";
import { getToleranceCents } from "../tax";
import { Pool } from "pg";
const pool = new Pool();

export async function closeAndIssue(req:any, res:any) {
  const { abn, taxType, periodId, thresholds } = req.body || {};
  if (!abn || !taxType || !periodId) {
    return res.status(400).json({ error: "MISSING_FIELDS" });
  }

  const { rows } = await pool.query(
    `SELECT expected_cents, actual_cents, delta_cents, tolerance_cents, status
       FROM recon_results
      WHERE abn=$1 AND tax_type=$2 AND period_id=$3
   ORDER BY created_at DESC
      LIMIT 1`,
    [abn, taxType, periodId]
  );

  if (rows.length === 0) {
    return res.status(409).json({ error: "RECON_PENDING" });
  }

  const latest = rows[0];
  const delta = Math.abs(Number(latest.delta_cents));
  const tolerance = Number(latest.tolerance_cents);
  const scheduleTolerance = getToleranceCents((String(taxType).toUpperCase() === "GST" ? "GST" : "PAYGW"));
  const epsilon = Number.isFinite(tolerance) ? tolerance : scheduleTolerance;
  const withinTolerance = Number.isFinite(tolerance) ? delta <= tolerance : delta <= scheduleTolerance;
  if (latest.status !== "OK" || !withinTolerance) {
    return res.status(409).json({
      error: "RECON_DELTA",
      status: latest.status,
      delta_cents: delta,
      tolerance_cents: epsilon
    });
  }

  await pool.query(
    `UPDATE periods
        SET state='CLOSING', final_liability_cents=$4
      WHERE abn=$1 AND tax_type=$2 AND period_id=$3
        AND state IN ('OPEN','CLOSING')`,
    [abn, taxType, periodId, Number(latest.expected_cents)]
  );

  const thr = {
    epsilon_cents: epsilon,
    variance_ratio: 0.25,
    dup_rate: 0.01,
    gap_minutes: 60,
    delta_vs_baseline: 0.2,
    ...(thresholds || {})
  };

  try {
    const rpt = await issueRPT(abn, taxType, periodId, thr);
    return res.json(rpt);
  } catch (e:any) {
    return res.status(400).json({ error: e.message });
  }
}

export async function payAto(req:any, res:any) {
  const { abn, taxType, periodId, rail } = req.body; // EFT|BPAY
  const pr = await pool.query("select * from rpt_tokens where abn= and tax_type= and period_id= order by id desc limit 1", [abn, taxType, periodId]);
  if (pr.rowCount === 0) return res.status(400).json({error:"NO_RPT"});
  const payload = pr.rows[0].payload;
  try {
    await resolveDestination(abn, rail, payload.reference);
    const r = await releasePayment(abn, taxType, periodId, payload.amount_cents, rail, payload.reference);
    await pool.query("update periods set state='RELEASED' where abn= and tax_type= and period_id=", [abn, taxType, periodId]);
    return res.json(r);
  } catch (e:any) {
    return res.status(400).json({ error: e.message });
  }
}

export async function paytoSweep(req:any, res:any) {
  const { abn, amount_cents, reference } = req.body;
  const r = await paytoDebit(abn, amount_cents, reference);
  return res.json(r);
}

export async function settlementWebhook(req:any, res:any) {
  const csvText = req.body?.csv || "";
  const rows = parseSettlementCSV(csvText);
  // TODO: For each row, post GST and NET into your ledgers, maintain txn_id reversal map
  return res.json({ ingested: rows.length });
}

export async function evidence(req:any, res:any) {
  const { abn, taxType, periodId } = req.query as any;
  res.json(await buildEvidenceBundle(abn, taxType, periodId));
}
