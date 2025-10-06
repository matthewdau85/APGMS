import { Pool } from "pg";
import { RULES_MANIFEST, RULES_MANIFEST_SHA256, RATES_VERSION } from "../rules/manifest";

const defaultPool = new Pool();

interface BuildEvidenceOptions {
  pool?: Pool;
}

export async function buildEvidenceBundle(abn: string, taxType: string, periodId: string, options: BuildEvidenceOptions = {}) {
  const client = options.pool ?? defaultPool;
  const periodQuery = await client.query(
    "select * from periods where abn=$1 and tax_type=$2 and period_id=$3",
    [abn, taxType, periodId]
  );
  const p = periodQuery.rows[0];
  const rptQuery = await client.query(
    "select * from rpt_tokens where abn=$1 and tax_type=$2 and period_id=$3 order by id desc limit 1",
    [abn, taxType, periodId]
  );
  const rpt = rptQuery.rows[0];
  const deltaQuery = await client.query(
    "select created_at as ts, amount_cents, hash_after, bank_receipt_hash from owa_ledger where abn=$1 and tax_type=$2 and period_id=$3 order by id",
    [abn, taxType, periodId]
  );
  const deltas = deltaQuery.rows;
  const last = deltas[deltas.length - 1];
  const bundle = {
    bas_labels: { W1: null, W2: null, "1A": null, "1B": null }, // TODO: populate
    rpt_payload: rpt?.payload ?? null,
    rpt_signature: rpt?.signature ?? null,
    owa_ledger_deltas: deltas,
    bank_receipt_hash: last?.bank_receipt_hash ?? null,
    anomaly_thresholds: p?.thresholds ?? {},
    discrepancy_log: [], // TODO: populate from recon diffs
    rules: {
      version: RATES_VERSION,
      manifest_sha256: RULES_MANIFEST_SHA256,
      files: RULES_MANIFEST.files,
    },
  };
  return bundle;
}
