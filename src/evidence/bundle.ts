import { getPool } from "../db/pool";
import { loadRubricManifestSync } from "../utils/rubric";

export async function buildEvidenceBundle(abn: string, taxType: string, periodId: string) {
  const pool = getPool();
  const periodRes = await pool.query(
    "select * from periods where abn=$1 and tax_type=$2 and period_id=$3",
    [abn, taxType, periodId]
  );
  const period = periodRes.rows[0] || null;
  const rptRes = await pool.query(
    "select * from rpt_tokens where abn=$1 and tax_type=$2 and period_id=$3 order by id desc limit 1",
    [abn, taxType, periodId]
  );
  const rpt = rptRes.rows[0] || null;
  const deltasRes = await pool.query(
    "select created_at as ts, amount_cents, hash_after, bank_receipt_hash, transfer_uuid from owa_ledger where abn=$1 and tax_type=$2 and period_id=$3 order by id",
    [abn, taxType, periodId]
  );
  const deltas = deltasRes.rows;
  const last = deltas[deltas.length - 1];

  const manifest = loadRubricManifestSync<{ pilot_ready?: any }>();
  const rulesSection = manifest.data?.pilot_ready?.rail_evidence ?? {};

  const approvals: any[] = [];
  if (rpt) {
    approvals.push({ stage: "RPT", actor: "rpt", signature: rpt.signature, issued_at: rpt.created_at });
  }
  if (last?.bank_receipt_hash) {
    approvals.push({ stage: "RELEASE", actor: "rails", bank_receipt_hash: last.bank_receipt_hash, transfer_uuid: last.transfer_uuid });
  }

  const narrative: string[] = [];
  if (rpt) narrative.push("RPT");
  const thresholds = (period?.thresholds as any) || {};
  if (thresholds.last_recon_status === "OK" || period?.state === "FINALIZED") {
    narrative.push("RECON_OK");
  }

  const bundle = {
    provider_ref: rpt?.payload?.reference ?? null,
    rules: {
      manifest_version: manifest.version,
      manifest_sha256: manifest.manifestSha256,
      rail_evidence: rulesSection,
    },
    approvals,
    narrative,
    bas_labels: { W1: null, W2: null, "1A": null, "1B": null },
    rpt_payload: rpt?.payload ?? null,
    rpt_signature: rpt?.signature ?? null,
    owa_ledger_deltas: deltas,
    bank_receipt_hash: last?.bank_receipt_hash ?? null,
    anomaly_thresholds: period?.thresholds ?? {},
    discrepancy_log: []
  };
  return bundle;
}
