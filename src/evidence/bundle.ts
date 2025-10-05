import { pool } from "../services/db";

const DEFAULT_LABELS = { W1: null, W2: null, "1A": null, "1B": null } as Record<string, number | null>;

export async function buildEvidenceBundle(abn: string, taxType: string, periodId: string) {
  const p = (await pool.query("select * from periods where abn= and tax_type= and period_id=", [abn, taxType, periodId])).rows[0];
  const rpt = (
    await pool.query("select * from rpt_tokens where abn= and tax_type= and period_id= order by id desc limit 1", [
      abn,
      taxType,
      periodId,
    ])
  ).rows[0];
  const deltas = (
    await pool.query(
      "select created_at as ts, amount_cents, balance_after_cents, hash_after, bank_receipt_hash from owa_ledger where abn= and tax_type= and period_id= order by id",
      [abn, taxType, periodId]
    )
  ).rows;
  const basLabels = (
    await pool.query("select labels from bas_labels where abn= and tax_type= and period_id=", [abn, taxType, periodId])
  ).rows[0]?.labels as Record<string, number | null> | undefined;
  const reconPayload = (
    await pool.query("select payload from recon_inputs where abn= and tax_type= and period_id=", [abn, taxType, periodId])
  ).rows[0]?.payload;
  const last = deltas[deltas.length - 1];
  const bundle = {
    bas_labels: basLabels || DEFAULT_LABELS,
    rpt_payload: rpt?.payload ?? null,
    rpt_signature: rpt?.signature ?? null,
    owa_ledger_deltas: deltas,
    bank_receipt_hash: last?.bank_receipt_hash ?? null,
    anomaly_thresholds: p?.thresholds ?? {},
    discrepancy_log: reconPayload?.discrepancies || [],
    recon_inputs: reconPayload || null,
  };
  return bundle;
}
