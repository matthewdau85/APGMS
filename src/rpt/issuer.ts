import { Pool } from "pg";
import crypto from "crypto";
import { signRpt, RptPayload } from "../crypto/ed25519";
import { isAnomalous } from "../anomaly/deterministic";
import { canonicalJson } from "../utils/canonical";
import { rulesManifestSha } from "../rules/manifest";

const pool = new Pool();
const secretKey = Buffer.from(process.env.RPT_ED25519_SECRET_BASE64 || "", "base64");

export async function issueRPT(
  abn: string,
  taxType: "PAYGW" | "GST",
  periodId: string,
  thresholds: Record<string, number>
) {
  if (!secretKey.length) throw new Error("RPT_ED25519_SECRET_BASE64 not configured");

  const periodRes = await pool.query(
    "select * from periods where abn=$1 and tax_type=$2 and period_id=$3",
    [abn, taxType, periodId]
  );
  if (periodRes.rowCount === 0) throw new Error("PERIOD_NOT_FOUND");
  const period = periodRes.rows[0];
  if (period.state !== "CLOSING") throw new Error("BAD_STATE");

  const anomalyVector = period.anomaly_vector || {};
  if (isAnomalous(anomalyVector, thresholds)) {
    await pool.query("update periods set state='BLOCKED_ANOMALY' where id=$1", [period.id]);
    throw new Error("BLOCKED_ANOMALY");
  }

  const epsilon = Math.abs(Number(period.final_liability_cents) - Number(period.credited_to_owa_cents));
  if (epsilon > (thresholds["epsilon_cents"] ?? 0)) {
    await pool.query("update periods set state='BLOCKED_DISCREPANCY' where id=$1", [period.id]);
    throw new Error("BLOCKED_DISCREPANCY");
  }

  const manifestSha = await rulesManifestSha();
  const keyId = process.env.RPT_KEY_ID || "dev-ed25519";

  const payload: RptPayload & { key_id: string; rules_manifest_sha256: string } = {
    entity_id: period.abn,
    period_id: period.period_id,
    tax_type: period.tax_type,
    amount_cents: Number(period.final_liability_cents),
    merkle_root: period.merkle_root,
    running_balance_hash: period.running_balance_hash,
    anomaly_vector: anomalyVector,
    thresholds,
    rail_id: "EFT",
    reference: process.env.ATO_PRN || "",
    expiry_ts: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    nonce: crypto.randomUUID(),
    key_id: keyId,
    rules_manifest_sha256: manifestSha,
  };

  const canonical = canonicalJson(payload);
  const payloadSha = crypto.createHash("sha256").update(canonical).digest("hex");
  const signature = signRpt(payload, new Uint8Array(secretKey));

  await pool.query(
    "insert into rpt_tokens(abn,tax_type,period_id,payload,signature,payload_c14n,payload_sha256) values ($1,$2,$3,$4,$5,$6,$7)",
    [abn, taxType, periodId, payload, signature, canonical, payloadSha]
  );
  await pool.query("update periods set state='READY_RPT' where id=$1", [period.id]);

  return { payload: { ...payload, payload_sha256: payloadSha }, signature };
}
