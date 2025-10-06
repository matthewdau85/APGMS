import { Pool } from "pg";
const pool = new Pool();

export async function buildEvidenceBundle(abn: string, taxType: string, periodId: string) {
  const p = (await pool.query("select * from periods where abn= and tax_type= and period_id=", [abn, taxType, periodId])).rows[0];
  const rptRow = (await pool.query("select * from rpt_tokens where abn= and tax_type= and period_id= order by id desc limit 1", [abn, taxType, periodId])).rows[0];
  const rptToken = rptRow?.payload_json ?? rptRow?.payload ?? null;
  const sigRaw = rptRow?.sig_ed25519 ?? rptRow?.signature ?? null;
  const rptSignature = sigRaw
    ? Buffer.isBuffer(sigRaw)
      ? Buffer.from(sigRaw).toString("base64url")
      : typeof sigRaw === "string"
        ? sigRaw
        : null
    : null;
  const deltas = (await pool.query("select created_at as ts, amount_cents, hash_after, bank_receipt_hash from owa_ledger where abn= and tax_type= and period_id= order by id", [abn, taxType, periodId])).rows;
  const last = deltas[deltas.length-1];
  const bundle = {
    bas_labels: { W1: null, W2: null, "1A": null, "1B": null }, // TODO: populate
    rpt: rptToken ?? null,
    rpt_payload: rptToken?.payload ?? null,
    rpt_signature: rptSignature,
    owa_ledger_deltas: deltas,
    bank_receipt_hash: last?.bank_receipt_hash ?? null,
    anomaly_thresholds: p?.thresholds ?? {},
    discrepancy_log: []  // TODO: populate from recon diffs
  };
  return bundle;
}
