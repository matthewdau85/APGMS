import { Pool } from "pg";
import crypto from "crypto";
import { signRpt, RptPayload } from "../crypto/ed25519";
import { exceeds } from "../anomaly/deterministic";

const pool = new Pool();
const secretKeyB64 = process.env.RPT_ED25519_SECRET_BASE64 || "";

export async function issueRPT(
  abn: string,
  taxType: "PAYGW" | "GST",
  periodId: string,
  thresholds: Record<string, number>
) {
  const period = await pool.query(
    `SELECT id, abn, tax_type, period_id, state, final_liability_cents,
            credited_to_owa_cents, merkle_root, running_balance_hash, anomaly_vector
       FROM periods
      WHERE abn=$1 AND tax_type=$2 AND period_id=$3`,
    [abn, taxType, periodId]
  );
  if (period.rowCount === 0) throw new Error("PERIOD_NOT_FOUND");
  const row = period.rows[0];
  if (row.state !== "CLOSING") throw new Error("BAD_STATE");

  const anomalyVector = row.anomaly_vector || {};
  if (exceeds(anomalyVector, thresholds)) {
    await pool.query(
      "UPDATE periods SET state='BLOCKED_ANOMALY' WHERE id=$1",
      [row.id]
    );
    throw new Error("BLOCKED_ANOMALY");
  }

  const epsilon = Math.abs(Number(row.final_liability_cents) - Number(row.credited_to_owa_cents));
  if (epsilon > (thresholds["epsilon_cents"] ?? 0)) {
    await pool.query(
      "UPDATE periods SET state='BLOCKED_DISCREPANCY' WHERE id=$1",
      [row.id]
    );
    throw new Error("BLOCKED_DISCREPANCY");
  }

  if (!secretKeyB64) throw new Error("NO_RPT_SECRET");
  const secretKey = new Uint8Array(Buffer.from(secretKeyB64, "base64"));

  const payload: RptPayload = {
    entity_id: row.abn,
    period_id: row.period_id,
    tax_type: row.tax_type,
    amount_cents: Number(row.final_liability_cents),
    merkle_root: row.merkle_root,
    running_balance_hash: row.running_balance_hash,
    anomaly_vector: anomalyVector,
    thresholds,
    rail_id: "EFT",
    reference: process.env.ATO_PRN || "",
    expiry_ts: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    nonce: crypto.randomUUID()
  };

  const payloadCanonical = JSON.stringify(payload);
  const payloadSha256 = crypto.createHash("sha256").update(payloadCanonical).digest("hex");
  const signature = signRpt(payload, secretKey);

  await pool.query(
    `INSERT INTO rpt_tokens
      (abn,tax_type,period_id,payload,signature,payload_c14n,payload_sha256)
      VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [abn, taxType, periodId, payload, signature, payloadCanonical, payloadSha256]
  );

  await pool.query(
    "UPDATE periods SET state='READY_RPT' WHERE id=$1",
    [row.id]
  );

  return { payload, signature, payload_sha256: payloadSha256 };
}
