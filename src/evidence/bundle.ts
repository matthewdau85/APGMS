import { pool } from "../db/pool";

export async function buildEvidenceBundle(abn: string, taxType: string, periodId: string) {
  const period = await pool.query(
    "SELECT * FROM periods WHERE abn=$1 AND tax_type=$2 AND period_id=$3",
    [abn, taxType, periodId]
  );
  const rpt = await pool.query(
    `SELECT * FROM rpt_tokens WHERE abn=$1 AND tax_type=$2 AND period_id=$3
     ORDER BY id DESC LIMIT 1`,
    [abn, taxType, periodId]
  );
  const deltas = await pool.query(
    `SELECT created_at AS ts, amount_cents, hash_after, bank_receipt_hash
       FROM owa_ledger WHERE abn=$1 AND tax_type=$2 AND period_id=$3
       ORDER BY id`,
    [abn, taxType, periodId]
  );
  const last = deltas.rows[deltas.rows.length - 1];
  const bundle = {
    bas_labels: { W1: null, W2: null, "1A": null, "1B": null },
    rpt_payload: rpt.rows[0]?.payload ?? null,
    rpt_signature: rpt.rows[0]?.signature ?? null,
    owa_ledger_deltas: deltas.rows,
    bank_receipt_hash: last?.bank_receipt_hash ?? null,
    anomaly_thresholds: period.rows[0]?.thresholds ?? {},
    discrepancy_log: [],
  };
  return bundle;
}
