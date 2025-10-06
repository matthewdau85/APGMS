import { getPool } from "../db/pool";

const pool = getPool();

export async function buildEvidenceBundle(abn: string, taxType: string, periodId: string) {
  const p = (
    await pool.query(
      "select * from periods where abn=$1 and tax_type=$2 and period_id=$3",
      [abn, taxType, periodId]
    )
  ).rows[0];
  const rpt = (
    await pool.query(
      "select * from rpt_tokens where abn=$1 and tax_type=$2 and period_id=$3 order by id desc limit 1",
      [abn, taxType, periodId]
    )
  ).rows[0];
  const deltas = (
    await pool.query(
      "select created_at as ts, amount_cents, hash_after, bank_receipt_hash from owa_ledger where abn=$1 and tax_type=$2 and period_id=$3 order by id",
      [abn, taxType, periodId]
    )
  ).rows;
  const last = deltas[deltas.length - 1];
  const bundle = {
    period: p
      ? {
          state: p.state,
          accrued_cents: Number(p.accrued_cents ?? 0),
          credited_to_owa_cents: Number(p.credited_to_owa_cents ?? 0),
          final_liability_cents: Number(p.final_liability_cents ?? 0),
          merkle_root: p.merkle_root,
          running_balance_hash: p.running_balance_hash,
          anomaly_vector: p.anomaly_vector ?? {},
          thresholds: p.thresholds ?? {},
        }
      : null,
    bas_labels: { W1: null, W2: null, "1A": null, "1B": null },
    rpt_payload: rpt?.payload ?? null,
    rpt_signature: rpt?.signature ?? null,
    rates_version: rpt?.rates_version ?? null,
    rpt_kid: rpt?.kid ?? null,
    rpt_nonce: rpt?.nonce ?? null,
    owa_ledger_deltas: deltas,
    bank_receipt_hash: last?.bank_receipt_hash ?? null,
    anomaly_thresholds: p?.thresholds ?? {},
    discrepancy_log: [],
  };
  return bundle;
}
