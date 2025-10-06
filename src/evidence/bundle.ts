import { Pool } from "pg";

const pool = new Pool();

interface SettlementShape {
  settlementId: string;
  rail: string;
  provider_ref: string;
  amount_cents: number;
  submittedAt: string;
  paidAt: string | null;
  statement_ref: string | null;
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
      `SELECT * FROM rpt_tokens
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

  let settlement: SettlementShape | null = null;
  if (period) {
    const { rows: settlementRows } = await pool.query(
      `SELECT * FROM settlements WHERE period_id=$1 ORDER BY submitted_at DESC LIMIT 1`,
      [period.id]
    );
    const row = settlementRows[0];
    if (row) {
      settlement = {
        settlementId: row.id,
        rail: row.rail,
        provider_ref: row.provider_ref,
        amount_cents: Number(row.amount_cents),
        submittedAt: row.submitted_at instanceof Date ? row.submitted_at.toISOString() : row.submitted_at,
        paidAt: row.paid_at instanceof Date ? row.paid_at.toISOString() : row.paid_at,
        statement_ref: row.statement_ref,
      };
    }
  }

  return {
    bas_labels: { W1: null, W2: null, "1A": null, "1B": null },
    rpt_payload: rpt?.payload ?? null,
    rpt_signature: rpt?.signature ?? null,
    owa_ledger_deltas: deltas,
    bank_receipt_hash: last?.bank_receipt_hash ?? null,
    anomaly_thresholds: period?.thresholds ?? {},
    discrepancy_log: [],
    settlement,
  };
}
