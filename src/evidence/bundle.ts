import { Pool } from "pg";
const pool = new Pool();

export async function buildEvidenceBundle(abn: string, taxType: string, periodId: string) {
  const p = (await pool.query(
    "SELECT * FROM periods WHERE abn=$1 AND tax_type=$2 AND period_id=$3",
    [abn, taxType, periodId]
  )).rows[0];
  const rpt = (await pool.query(
    "SELECT payload, signature, created_at FROM rpt_tokens WHERE abn=$1 AND tax_type=$2 AND period_id=$3 ORDER BY id DESC LIMIT 1",
    [abn, taxType, periodId]
  )).rows[0];
  const deltas = (await pool.query(
    "SELECT created_at AS ts, amount_cents, hash_after, bank_receipt_hash FROM owa_ledger WHERE abn=$1 AND tax_type=$2 AND period_id=$3 ORDER BY id",
    [abn, taxType, periodId]
  )).rows;
  const last = deltas[deltas.length-1];
  const bundle = {
    bas_labels: { W1: null, W2: null, "1A": null, "1B": null },
    rpt_payload: rpt?.payload ?? null,
    rpt_signature: rpt?.signature ?? null,
    owa_ledger_deltas: deltas,
    bank_receipt_hash: last?.bank_receipt_hash ?? null,
    anomaly_thresholds: p?.thresholds ?? {},
    discrepancy_log: [] as any[],
  };
  return bundle;
}
