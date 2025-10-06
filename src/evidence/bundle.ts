import { pool } from "../db/pool";

export async function buildEvidenceBundle(abn: string, taxType: string, periodId: string) {
  const period = (
    await pool.query(
      `SELECT *
         FROM periods
        WHERE abn = $1 AND tax_type = $2 AND period_id = $3`,
      [abn, taxType, periodId]
    )
  ).rows[0];
  const rpt = (
    await pool.query(
      `SELECT payload, signature, payload_sha256, payload_c14n, created_at
         FROM rpt_tokens
        WHERE abn = $1 AND tax_type = $2 AND period_id = $3
        ORDER BY id DESC
        LIMIT 1`,
      [abn, taxType, periodId]
    )
  ).rows[0];
  const deltas = (
    await pool.query(
      `SELECT created_at AS ts, amount_cents, balance_after_cents, bank_receipt_hash, prev_hash, hash_after
         FROM owa_ledger
        WHERE abn = $1 AND tax_type = $2 AND period_id = $3
        ORDER BY id`,
      [abn, taxType, periodId]
    )
  ).rows;
  const rules = (
    await pool.query(
      `SELECT manifest_sha256, rates_version, published_at
         FROM rules_manifests
        WHERE tax_type = $1
        ORDER BY effective_from DESC NULLS LAST, created_at DESC
        LIMIT 1`,
      [taxType]
    )
  ).rows[0];
  const settlement = (
    await pool.query(
      `SELECT provider_ref, imported_rows, manifest_sha256, created_at
         FROM reconciliation_imports
        WHERE ($1 IS NULL OR abn = $1)
          AND ($2 IS NULL OR tax_type = $2)
          AND ($3 IS NULL OR period_id = $3)
        ORDER BY created_at DESC
        LIMIT 5`,
      [abn ?? null, taxType ?? null, periodId ?? null]
    )
  ).rows;
  const approvals = (
    await pool.query(
      `SELECT approver, role, approved_at, comment
         FROM evidence_approvals
        WHERE abn = $1 AND tax_type = $2 AND period_id = $3
        ORDER BY approved_at`,
      [abn, taxType, periodId]
    )
  ).rows;
  const narrative = (
    await pool.query(
      `SELECT narrative, author, created_at
         FROM evidence_narratives
        WHERE abn = $1 AND tax_type = $2 AND period_id = $3
        ORDER BY created_at DESC
        LIMIT 1`,
      [abn, taxType, periodId]
    )
  ).rows[0];
  const last = deltas[deltas.length - 1];
  const bundle = {
    version: "2.0",
    meta: { generated_at: new Date().toISOString(), abn, taxType, periodId },
    period: period
      ? {
          state: period.state,
          accrued_cents: Number(period.accrued_cents || 0),
          credited_to_owa_cents: Number(period.credited_to_owa_cents || 0),
          final_liability_cents: Number(period.final_liability_cents || 0),
          merkle_root: period.merkle_root,
          running_balance_hash: period.running_balance_hash,
          anomaly_vector: period.anomaly_vector,
          thresholds: period.thresholds,
        }
      : null,
    rules: rules
      ? {
          manifest_sha256: rules.manifest_sha256,
          rates_version: rules.rates_version,
          published_at: rules.published_at,
        }
      : null,
    rpt_payload: rpt?.payload ?? null,
    rpt_signature: rpt?.signature ?? null,
    rpt_payload_sha256: rpt?.payload_sha256 ?? null,
    rpt_payload_c14n: rpt?.payload_c14n ?? null,
    owa_ledger_deltas: deltas,
    bank_receipt_hash: last?.bank_receipt_hash ?? null,
    bas_labels: { W1: null, W2: null, "1A": null, "1B": null },
    settlement_imports: settlement.map((row) => ({
      provider_ref: row.provider_ref,
      manifest_sha256: row.manifest_sha256,
      imported_rows: row.imported_rows,
      imported_at: row.created_at,
    })),
    narrative: narrative || null,
    approvals,
    discrepancy_log: [],
  };
  return bundle;
}
