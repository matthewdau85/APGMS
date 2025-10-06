import { q } from "../db";

export const SQL_SELECT_PERIOD_FOR_BUNDLE =
  "SELECT * FROM periods WHERE abn=$1 AND tax_type=$2 AND period_id=$3";
export const SQL_SELECT_RPT_FOR_BUNDLE =
  "SELECT * FROM rpt_tokens WHERE abn=$1 AND tax_type=$2 AND period_id=$3 ORDER BY id DESC LIMIT 1";
export const SQL_SELECT_LEDGER_FOR_BUNDLE =
  "SELECT created_at AS ts, amount_cents, hash_after, bank_receipt_hash FROM owa_ledger WHERE abn=$1 AND tax_type=$2 AND period_id=$3 ORDER BY id";

export async function buildEvidenceBundle(abn: string, taxType: string, periodId: string) {
  const p = (await q(SQL_SELECT_PERIOD_FOR_BUNDLE, [abn, taxType, periodId])).rows[0];
  const rpt = (await q(SQL_SELECT_RPT_FOR_BUNDLE, [abn, taxType, periodId])).rows[0];
  const deltas = (await q(SQL_SELECT_LEDGER_FOR_BUNDLE, [abn, taxType, periodId])).rows;
  const last = deltas[deltas.length - 1];
  const bundle = {
    bas_labels: { W1: null, W2: null, "1A": null, "1B": null }, // TODO: populate
    rpt_payload: rpt?.payload ?? null,
    rpt_signature: rpt?.signature ?? null,
    owa_ledger_deltas: deltas,
    bank_receipt_hash: last?.bank_receipt_hash ?? null,
    anomaly_thresholds: p?.thresholds ?? {},
    discrepancy_log: [], // TODO: populate from recon diffs
  };
  return bundle;
}
