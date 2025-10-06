import crypto from "crypto";
import { signRpt, RptPayload } from "../crypto/ed25519";
import { isAnomalous, Thresholds as AnomalyThresholds } from "../anomaly/deterministic";
import { pool } from "../db/pool";

function getSecretKey(): Uint8Array {
  const secretB64 = process.env.RPT_ED25519_SECRET_BASE64 || "";
  const decoded = Buffer.from(secretB64, "base64");
  if (decoded.length !== 64) {
    throw new Error("RPT_SECRET_INVALID");
  }
  return new Uint8Array(decoded);
}

export async function issueRPT(
  abn: string,
  taxType: "PAYGW" | "GST",
  periodId: string,
  thresholds: Record<string, number>
) {
  const p = await pool.query(
    "SELECT * FROM periods WHERE abn=$1 AND tax_type=$2 AND period_id=$3",
    [abn, taxType, periodId]
  );
  if (p.rowCount === 0) throw new Error("PERIOD_NOT_FOUND");
  const row = p.rows[0];
  if (row.state !== "CLOSING") throw new Error("BAD_STATE");

  const v = row.anomaly_vector || {};
  const anomalyThresholds: AnomalyThresholds = {
    variance_ratio: thresholds?.variance_ratio,
    dup_rate: thresholds?.dup_rate,
    gap_minutes: thresholds?.gap_minutes,
    delta_vs_baseline: thresholds?.delta_vs_baseline,
  };
  if (isAnomalous(v, anomalyThresholds)) {
    await pool.query("UPDATE periods SET state='BLOCKED_ANOMALY' WHERE id=$1", [row.id]);
    throw new Error("BLOCKED_ANOMALY");
  }
  const epsilon = Math.abs(Number(row.final_liability_cents) - Number(row.credited_to_owa_cents));
  if (epsilon > (thresholds["epsilon_cents"] ?? 0)) {
    await pool.query("UPDATE periods SET state='BLOCKED_DISCREPANCY' WHERE id=$1", [row.id]);
    throw new Error("BLOCKED_DISCREPANCY");
  }

  const payload: RptPayload = {
    entity_id: row.abn,
    period_id: row.period_id,
    tax_type: row.tax_type,
    amount_cents: Number(row.final_liability_cents),
    merkle_root: row.merkle_root,
    running_balance_hash: row.running_balance_hash,
    anomaly_vector: v,
    thresholds,
    rail_id: "EFT",
    reference: process.env.ATO_PRN || "",
    expiry_ts: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    nonce: crypto.randomUUID(),
  };
  const payloadStr = JSON.stringify(payload);
  const payloadSha256 = crypto.createHash("sha256").update(payloadStr).digest("hex");
  const signature = signRpt(payload, getSecretKey());
  await pool.query(
    "INSERT INTO rpt_tokens(abn,tax_type,period_id,payload,signature,payload_c14n,payload_sha256) VALUES ($1,$2,$3,$4,$5,$6,$7)",
    [abn, taxType, periodId, payload, signature, payloadStr, payloadSha256]
  );
  await pool.query("UPDATE periods SET state='READY_RPT' WHERE id=$1", [row.id]);
  return { payload, signature, payload_sha256: payloadSha256 };
}
