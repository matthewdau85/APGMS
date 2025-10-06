import { Pool } from "pg";

let pool: Pool = new Pool();

export function setEvidencePool(custom: Pool) {
  pool = custom;
}

export async function buildEvidenceBundle(abn: string, taxType: string, periodId: string) {
  const period = (
    await pool.query(
      `SELECT * FROM periods WHERE abn=$1 AND tax_type=$2 AND period_id=$3`,
      [abn, taxType, periodId]
    )
  ).rows[0];
  const rpt = (
    await pool.query(
      `SELECT *
         FROM rpt_tokens
        WHERE abn=$1 AND tax_type=$2 AND period_id=$3
        ORDER BY id DESC
        LIMIT 1`,
      [abn, taxType, periodId]
    )
  ).rows[0];
  const deltas = (
    await pool.query(
      `SELECT created_at AS ts, amount_cents, hash_after, bank_receipt_hash
         FROM owa_ledger
        WHERE abn=$1 AND tax_type=$2 AND period_id=$3
        ORDER BY id`,
      [abn, taxType, periodId]
    )
  ).rows;
  const last = deltas[deltas.length - 1];
  const settlement = (
    await pool.query(
      `SELECT provider_ref, rail, paid_at, amount_cents
         FROM settlements
        WHERE abn=$1 AND period_id=$2 AND verified IS TRUE
        ORDER BY paid_at DESC NULLS LAST
        LIMIT 1`,
      [abn, periodId]
    )
  ).rows[0] || null;

  return {
    bas_labels: { W1: null, W2: null, "1A": null, "1B": null },
    rpt_payload: rpt?.payload ?? null,
    rpt_signature: rpt?.signature ?? null,
    owa_ledger_deltas: deltas,
    bank_receipt_hash: last?.bank_receipt_hash ?? null,
    anomaly_thresholds: period?.thresholds ?? {},
    discrepancy_log: [],
    settlement: settlement
      ? {
          provider_ref: settlement.provider_ref,
          rail: settlement.rail,
          paid_at: settlement.paid_at,
          amount_cents: Number(settlement.amount_cents ?? 0),
        }
      : null,
  };
}
