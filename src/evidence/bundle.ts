import { createHash } from "crypto";
import { Pool } from "pg";
const pool = new Pool();

export async function buildEvidenceBundle(abn: string, taxType: string, periodId: string) {
  const p = (
    await pool.query(
      "select * from periods where abn= and tax_type= and period_id=",
      [abn, taxType, periodId]
    )
  ).rows[0];
  const rpt = (
    await pool.query(
      "select * from rpt_tokens where abn= and tax_type= and period_id= order by id desc limit 1",
      [abn, taxType, periodId]
    )
  ).rows[0];
  const deltas = (
    await pool.query(
      "select created_at as ts, amount_cents, hash_after, bank_receipt_hash from owa_ledger where abn= and tax_type= and period_id= order by id",
      [abn, taxType, periodId]
    )
  ).rows;
  const last = deltas[deltas.length - 1];

  const serializedDeltas = JSON.stringify(deltas ?? []);
  const ledgerDigest = deltas.length
    ? createHash("sha256").update(serializedDeltas).digest("hex")
    : null;
  const rptDigest = rpt?.payload
    ? createHash("sha256").update(JSON.stringify(rpt.payload)).digest("hex")
    : null;
  const files = [
    ...(ledgerDigest ? [{ name: "owa-ledger.json", sha256: ledgerDigest }] : []),
    ...(rptDigest ? [{ name: "rpt-payload.json", sha256: rptDigest }] : []),
  ];
  const manifestSha = files.length
    ? createHash("sha256")
        .update(files.map((f) => `${f.name}:${f.sha256}`).join("|"))
        .digest("hex")
    : null;

  const bundle = {
    bas_labels: { W1: null, W2: null, "1A": null, "1B": null }, // TODO: populate
    rpt_payload: rpt?.payload ?? null,
    rpt_signature: rpt?.signature ?? null,
    owa_ledger_deltas: deltas,
    bank_receipt_hash: last?.bank_receipt_hash ?? null,
    anomaly_thresholds: p?.thresholds ?? {},
    discrepancy_log: [], // TODO: populate from recon diffs
    rules: {
      manifest_sha256: manifestSha,
      files,
    },
    settlement: null,
    approvals: [],
    narrative: "why released",
    rates_version: "2024-25",
  };
  return bundle;
}
