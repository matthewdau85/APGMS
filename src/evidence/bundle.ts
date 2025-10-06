import { Pool } from "pg";

const pool = new Pool();

export async function buildEvidenceBundle(abn: string, taxType: string, periodId: string) {
  const periodRes = await pool.query(
    `select abn,tax_type,period_id,state,accrued_cents,credited_to_owa_cents,final_liability_cents,
            merkle_root,running_balance_hash,anomaly_vector,thresholds
       from periods
      where abn=$1 and tax_type=$2 and period_id=$3`,
    [abn, taxType, periodId]
  );
  const period = periodRes.rows[0] ?? null;

  const rptRes = await pool.query(
    `select payload, signature, payload_sha256, created_at
       from rpt_tokens
      where abn=$1 and tax_type=$2 and period_id=$3
      order by id desc limit 1`,
    [abn, taxType, periodId]
  );
  const rpt = rptRes.rows[0] ?? null;

  const ledgerRes = await pool.query(
    `select created_at as ts, amount_cents, balance_after_cents, hash_after, bank_receipt_hash
       from owa_ledger
      where abn=$1 and tax_type=$2 and period_id=$3
      order by id`,
    [abn, taxType, periodId]
  );

  const deltas = ledgerRes.rows.map((row) => ({
    ts: row.ts,
    amount_cents: Number(row.amount_cents ?? 0),
    balance_after_cents: Number(row.balance_after_cents ?? 0),
    hash_after: row.hash_after,
    bank_receipt_hash: row.bank_receipt_hash,
  }));
  const last = deltas[deltas.length - 1] ?? null;

  return {
    bas_labels: { W1: null, W2: null, "1A": null, "1B": null },
    rpt_payload: rpt?.payload ?? null,
    rpt_signature: rpt?.signature ?? null,
    rpt_sha256: rpt?.payload_sha256 ?? null,
    owa_ledger_deltas: deltas,
    bank_receipt_hash: last?.bank_receipt_hash ?? null,
    anomaly_thresholds: period?.thresholds ?? {},
    discrepancy_log: [],
    period,
  };
}
