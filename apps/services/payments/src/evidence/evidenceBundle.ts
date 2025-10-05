import pg from "pg";
const { PoolClient } = pg;
import { canonicalJson, sha256Hex } from "../utils/crypto";

type BuildParams = {
  abn: string; taxType: string; periodId: string;
  bankReceipts: Array<{provider: string; receipt_id: string}>;
  atoReceipts: Array<{submission_id: string; receipt_id: string}>;
  operatorOverrides: Array<{who: string; why: string; ts: string}>;
  owaAfterHash: string;
};

export async function buildEvidenceBundle(client: PoolClient, p: BuildParams) {
  const rpt = await client.query(
    "SELECT id as rpt_id, payload_c14n, payload_sha256, signature FROM rpt_tokens WHERE abn=$1 AND tax_type=$2 AND period_id=$3 AND status='ISSUED' ORDER BY created_at DESC LIMIT 1",
    [p.abn, p.taxType, p.periodId]
  );
  if (!rpt.rows.length) throw new Error("Missing RPT for bundle");
  const r = rpt.rows[0];

  const thresholds = { variance_pct: 0.02, dup_rate: 0.01, gap_allowed: 3 };
  const anomalies = { variance: 0.0, dups: 0, gaps: 0 };
  const normalization = { payroll_hash: "NA", pos_hash: "NA" };

  const beforeQ = await client.query(
    "SELECT COALESCE(SUM(amount_cents),0) bal FROM owa_ledger WHERE abn=$1 AND tax_type=$2 AND period_id=$3 AND id < (SELECT max(id) FROM owa_ledger WHERE abn=$1 AND tax_type=$2 AND period_id=$3)",
    [p.abn, p.taxType, p.periodId]
  );
  const afterQ = await client.query(
    "SELECT COALESCE(SUM(amount_cents),0) bal FROM owa_ledger WHERE abn=$1 AND tax_type=$2 AND period_id=$3",
    [p.abn, p.taxType, p.periodId]
  );
  const balBefore = Number(beforeQ.rows[0]?.bal || 0);
  const balAfter = Number(afterQ.rows[0]?.bal || 0);

  const payload_sha256 = sha256Hex(r.payload_c14n);

  const ins = `
    INSERT INTO evidence_bundles (
      abn, tax_type, period_id, payload_sha256, rpt_id, rpt_payload, rpt_signature,
      thresholds_json, anomaly_vector, normalization_hashes,
      owa_balance_before, owa_balance_after,
      bank_receipts, ato_receipts, operator_overrides
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb,$11,$12,$13::jsonb,$14::jsonb,$15::jsonb)
    ON CONFLICT (abn, tax_type, period_id) DO UPDATE SET
      bank_receipts = EXCLUDED.bank_receipts,
      ato_receipts = EXCLUDED.ato_receipts,
      owa_balance_before = EXCLUDED.owa_balance_before,
      owa_balance_after = EXCLUDED.owa_balance_after
    RETURNING bundle_id
  `;
  const vals = [
    p.abn, p.taxType, p.periodId, payload_sha256, r.rpt_id, r.payload_c14n, r.signature,
    canonicalJson(thresholds), canonicalJson(anomalies), canonicalJson(normalization),
    balBefore, balAfter,
    canonicalJson(p.bankReceipts), canonicalJson(p.atoReceipts), canonicalJson(p.operatorOverrides)
  ];
  const out = await client.query(ins, vals);
  return out.rows[0].bundle_id as number;
}
