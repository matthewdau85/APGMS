import { Pool } from "pg";
import { sha256Hex } from "../crypto/merkle";
const pool = new Pool();

export async function buildEvidenceBundle(abn: string, taxType: string, periodId: string) {
  const p = (await pool.query("select * from periods where abn= and tax_type= and period_id=", [abn, taxType, periodId])).rows[0];
  const rpt = (await pool.query("select * from rpt_tokens where abn= and tax_type= and period_id= order by id desc limit 1", [abn, taxType, periodId])).rows[0];
  const deltas = (await pool.query("select created_at as ts, amount_cents, transfer_uuid, hash_after, bank_receipt_hash from owa_ledger where abn= and tax_type= and period_id= order by id", [abn, taxType, periodId])).rows;
  const last = deltas[deltas.length-1];
  const manifestSource = (p as any)?.rules_manifest_sha256 || p?.merkle_root || "";
  const manifestHash = manifestSource ? sha256Hex(String(manifestSource)) : null;
  const narrative = `Recon narrative for ${abn} ${taxType} ${periodId}`;
  const bundle = {
    bas_labels: { W1: null, W2: null, "1A": null, "1B": null }, // TODO: populate
    rpt_payload: rpt?.payload ?? null,
    rpt_signature: rpt?.signature ?? null,
    owa_ledger_deltas: deltas,
    bank_receipt_hash: last?.bank_receipt_hash ?? null,
    provider_ref: last?.transfer_uuid ?? null,
    anomaly_thresholds: p?.thresholds ?? {},
    discrepancy_log: [],  // TODO: populate from recon diffs
    rules: {
      manifest_sha256: manifestHash,
      narrative
    }
  };
  return bundle;
}
