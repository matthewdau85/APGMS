import { Pool } from "pg";
const pool = new Pool();

export async function buildEvidenceBundle(abn: string, taxType: string, periodId: string) {
  const p = (await pool.query("select * from periods where abn=$1 and tax_type=$2 and period_id=$3", [abn, taxType, periodId])).rows[0];
  const rpt = (await pool.query("select * from rpt_tokens where abn=$1 and tax_type=$2 and period_id=$3 order by id desc limit 1", [abn, taxType, periodId])).rows[0];
  const deltas = (await pool.query("select created_at as ts, amount_cents, hash_after, bank_receipt_hash, bank_receipt_id from owa_ledger where abn=$1 and tax_type=$2 and period_id=$3 order by id", [abn, taxType, periodId])).rows;
  const receipts = (await pool.query(
    "select id, channel, provider_ref, dry_run, shadow_only, created_at from bank_receipts where abn=$1 and tax_type=$2 and period_id=$3 order by id",
    [abn, taxType, periodId]
  )).rows;
  const lastLedger = deltas[deltas.length - 1];
  const bundle = {
    bas_labels: { W1: null, W2: null, "1A": null, "1B": null },
    rpt_payload: rpt?.payload ?? null,
    rpt_signature: rpt?.signature ?? null,
    owa_ledger_deltas: deltas,
    bank_receipts: receipts,
    latest_bank_receipt_id: lastLedger?.bank_receipt_id ?? null,
    bank_receipt_hash: lastLedger?.bank_receipt_hash ?? null,
    anomaly_thresholds: p?.thresholds ?? {},
    discrepancy_log: [],
  };
  return bundle;
}
