import { Pool } from "pg";

const pool = new Pool();

export async function buildEvidenceBundle(abn: string, taxType: string, periodId: string) {
  const period = await pool.query(
    `SELECT state, accrued_cents, credited_to_owa_cents, final_liability_cents, thresholds
       FROM periods
      WHERE abn=$1 AND tax_type=$2 AND period_id=$3`,
    [abn, taxType, periodId]
  );

  const rpt = await pool.query(
    `SELECT payload, payload_c14n, payload_sha256, signature, created_at
       FROM rpt_tokens
      WHERE abn=$1 AND tax_type=$2 AND period_id=$3
      ORDER BY id DESC LIMIT 1`,
    [abn, taxType, periodId]
  );

  const ledger = await pool.query(
    `SELECT created_at AS ts, amount_cents, balance_after_cents, hash_after, bank_receipt_hash
       FROM owa_ledger
      WHERE abn=$1 AND tax_type=$2 AND period_id=$3
      ORDER BY id`,
    [abn, taxType, periodId]
  );

  const deltas = ledger.rows;
  const tail = deltas[deltas.length - 1];

  return {
    meta: {
      generated_at: new Date().toISOString(),
      abn,
      taxType,
      periodId
    },
    period: period.rows[0] || null,
    rpt: rpt.rows[0] || null,
    owa_ledger_deltas: deltas,
    bank_receipt_hash: tail?.bank_receipt_hash ?? null,
    bas_labels: { W1: null, W2: null, "1A": null, "1B": null },
    discrepancy_log: []
  };
}
