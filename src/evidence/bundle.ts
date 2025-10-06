import { pool } from "../db/pool";
import { sql } from "../db/sql";

export async function buildEvidenceBundle(abn: string, taxType: string, periodId: string) {
  const periodQuery = sql`
    SELECT * FROM periods WHERE abn=${abn} AND tax_type=${taxType} AND period_id=${periodId}
  `;
  const p = (await pool.query(periodQuery.text, periodQuery.params)).rows[0];
  const rptQuery = sql`
    SELECT * FROM rpt_tokens WHERE abn=${abn} AND tax_type=${taxType} AND period_id=${periodId}
    ORDER BY id DESC LIMIT 1
  `;
  const rpt = (await pool.query(rptQuery.text, rptQuery.params)).rows[0];
  const ledgerQuery = sql`
    SELECT created_at AS ts, amount_cents, hash_after, bank_receipt_hash
      FROM owa_ledger
     WHERE abn=${abn} AND tax_type=${taxType} AND period_id=${periodId}
     ORDER BY id
  `;
  const deltas = (await pool.query(ledgerQuery.text, ledgerQuery.params)).rows;
  const last = deltas[deltas.length - 1];
  return {
    bas_labels: { W1: null, W2: null, "1A": null, "1B": null },
    rpt_payload: rpt?.payload ?? null,
    rpt_signature: rpt?.signature ?? null,
    owa_ledger_deltas: deltas,
    bank_receipt_hash: last?.bank_receipt_hash ?? null,
    anomaly_thresholds: p?.thresholds ?? {},
    discrepancy_log: [],
  };
}
