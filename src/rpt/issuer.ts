import crypto from "crypto";
import { Pool } from "pg";
import nacl from "tweetnacl";

import { RptPayload } from "../crypto/ed25519";
import { exceeds } from "../anomaly/deterministic";

const pool = new Pool();
const secretKeyBuf = Buffer.from(process.env.RPT_ED25519_SECRET_BASE64 || "", "base64");
const keyId = process.env.RPT_KEY_ID || "demo-ed25519";
const atoReference = process.env.ATO_PRN || "1234567890";

function canonicalJson(value: any): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  const keys = Object.keys(value).sort();
  const entries = keys.map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`);
  return `{${entries.join(",")}}`;
}

export async function issueRPT(
  abn: string,
  taxType: "PAYGW" | "GST",
  periodId: string,
  thresholds: Record<string, number>
) {
  if (secretKeyBuf.length !== 64) {
    throw new Error("RPT_ED25519_SECRET_BASE64 must decode to 64 bytes");
  }

  const periodRes = await pool.query(
    `SELECT * FROM periods WHERE abn=$1 AND tax_type=$2 AND period_id=$3`,
    [abn, taxType, periodId]
  );
  if (periodRes.rowCount === 0) throw new Error("PERIOD_NOT_FOUND");
  const period = periodRes.rows[0];
  if (period.state !== "CLOSING") throw new Error("BAD_STATE");

  const anomalyVector = period.anomaly_vector || {};
  if (exceeds(anomalyVector, thresholds)) {
    await pool.query(`UPDATE periods SET state='BLOCKED_ANOMALY' WHERE id=$1`, [period.id]);
    throw new Error("BLOCKED_ANOMALY");
  }

  const epsilon = Math.abs(Number(period.final_liability_cents) - Number(period.credited_to_owa_cents));
  if (epsilon > (thresholds["epsilon_cents"] ?? 0)) {
    await pool.query(`UPDATE periods SET state='BLOCKED_DISCREPANCY' WHERE id=$1`, [period.id]);
    throw new Error("BLOCKED_DISCREPANCY");
  }

  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  const nonce = crypto.randomUUID();

  const payload: RptPayload = {
    entity_id: period.abn,
    period_id: period.period_id,
    tax_type: period.tax_type,
    amount_cents: Number(period.final_liability_cents),
    merkle_root: period.merkle_root,
    running_balance_hash: period.running_balance_hash,
    anomaly_vector: anomalyVector,
    thresholds,
    rail_id: "EFT",
    reference: atoReference,
    expiry_ts: expiresAt,
    nonce,
  };

  const payloadC14n = canonicalJson(payload);
  const payloadSha256 = crypto.createHash("sha256").update(payloadC14n).digest("hex");
  const signatureBytes = nacl.sign.detached(new TextEncoder().encode(payloadC14n), new Uint8Array(secretKeyBuf));
  const signature = Buffer.from(signatureBytes).toString("base64");

  await pool.query(
    `UPDATE rpt_tokens
        SET status='superseded'
      WHERE abn=$1 AND tax_type=$2 AND period_id=$3
        AND status IN ('pending','active')`,
    [abn, taxType, periodId]
  );

  await pool.query(
    `INSERT INTO rpt_tokens(
       abn,tax_type,period_id,key_id,payload,signature,status,payload_c14n,payload_sha256,nonce,expires_at
     ) VALUES ($1,$2,$3,$4,$5,$6,'active',$7,$8,$9,$10)`,
    [abn, taxType, periodId, keyId, payload, signature, payloadC14n, payloadSha256, nonce, expiresAt]
  );

  await pool.query(`UPDATE periods SET state='READY_RPT' WHERE id=$1`, [period.id]);

  return { payload, payload_c14n: payloadC14n, payload_sha256: payloadSha256, signature, nonce, expires_at: expiresAt };
}
