import { Pool } from "pg";

const pool = new Pool();

export async function buildEvidenceBundle(abn: string, taxType: string, periodId: string) {
  const periodRes = await pool.query(
    `SELECT anomaly_vector, thresholds FROM periods WHERE abn=$1 AND tax_type=$2 AND period_id=$3`,
    [abn, taxType, periodId]
  );
  const period = periodRes.rows[0] ?? null;

  const rptRes = await pool.query(
    `SELECT payload, signature
       FROM rpt_tokens
      WHERE abn=$1 AND tax_type=$2 AND period_id=$3
      ORDER BY id DESC LIMIT 1`,
    [abn, taxType, periodId]
  );
  const rpt = rptRes.rows[0] ?? null;

  const ledgerRes = await pool.query(
    `SELECT created_at AS ts, amount_cents, hash_after, bank_receipt_hash, transfer_uuid, balance_after_cents
       FROM owa_ledger
      WHERE abn=$1 AND tax_type=$2 AND period_id=$3
      ORDER BY id`,
    [abn, taxType, periodId]
  );
  const deltas = ledgerRes.rows;
  const last = deltas.length ? deltas[deltas.length - 1] : null;

  return {
    bas_labels: { W1: null, W2: null, "1A": null, "1B": null },
    rpt_payload: rpt?.payload ?? null,
    rpt_signature: rpt?.signature ?? null,
    owa_ledger_deltas: deltas,
    bank_receipt_hash: last?.bank_receipt_hash ?? null,
    anomaly_thresholds: period?.thresholds ?? {},
    discrepancy_log: [],
  };
}
