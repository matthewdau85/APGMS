import { Pool } from "pg";
const pool = new Pool();

export async function buildEvidenceBundle(abn: string, taxType: string, periodId: string) {
  const p = (await pool.query("select * from periods where abn= and tax_type= and period_id=", [abn, taxType, periodId])).rows[0];
  const rpt = (await pool.query("select * from rpt_tokens where abn= and tax_type= and period_id= order by id desc limit 1", [abn, taxType, periodId])).rows[0];
  const deltas = (await pool.query("select created_at as ts, amount_cents, hash_after, bank_receipt_hash from owa_ledger where abn= and tax_type= and period_id= order by id", [abn, taxType, periodId])).rows;
  const last = deltas[deltas.length-1];
  const recon = (await pool.query(
    "select status, deltas, reasons from recon_results where tenant_id=$1 and tax_type=$2 and period_id=$3 order by created_at desc limit 1",
    [abn, taxType, periodId]
  )).rows[0];
  const bundle = {
    bas_labels: { W1: null, W2: null, "1A": null, "1B": null }, // TODO: populate
    rpt_payload: rpt?.payload ?? null,
    rpt_signature: rpt?.signature ?? null,
    owa_ledger_deltas: deltas,
    bank_receipt_hash: last?.bank_receipt_hash ?? null,
    anomaly_thresholds: p?.thresholds ?? {},
    discrepancy_log: [],  // TODO: populate from recon diffs
    recon_summary: recon
      ? {
          status: recon.status,
          deltas: typeof recon.deltas === "string" ? JSON.parse(recon.deltas) : recon.deltas,
          reasons: typeof recon.reasons === "string" ? JSON.parse(recon.reasons) : recon.reasons,
        }
      : null,
  };
  return bundle;
}
