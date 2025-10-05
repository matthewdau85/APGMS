import { Pool } from "pg";
import crypto from "crypto";
import { canonicalJson, signRpt, RptPayload } from "../crypto/ed25519";
import { isAnomalous, Thresholds, AnomalyVector } from "../anomaly/deterministic";

const pool = new Pool();

function base64ToBuffer(value: string): Buffer {
  const normalised = value.replace(/-/g, "+").replace(/_/g, "/");
  const pad = normalised.length % 4;
  const padded = pad ? normalised + "=".repeat(4 - pad) : normalised;
  return Buffer.from(padded, "base64");
}

function loadSecretKey(): Uint8Array {
  const raw = process.env.RPT_ED25519_SECRET_BASE64 || "";
  if (!raw) throw new Error("RPT_ED25519_SECRET_BASE64 missing");
  const key = base64ToBuffer(raw);
  if (key.length !== 32 && key.length !== 64) {
    throw new Error(`RPT_ED25519_SECRET_BASE64 must decode to 32 or 64 bytes (got ${key.length})`);
  }
  return new Uint8Array(key);
}

function asNumber(value: any): number {
  if (value == null) return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function anomalyFromRow(row: any): AnomalyVector {
  const raw = (row?.anomaly_vector as Record<string, number>) || {};
  return {
    variance_ratio: asNumber(raw.variance_ratio),
    dup_rate: asNumber(raw.dup_rate),
    gap_minutes: asNumber(raw.gap_minutes),
    delta_vs_baseline: asNumber(raw.delta_vs_baseline),
  };
}

function mergeThresholds(row: any, overrides: Record<string, number>): Thresholds & { epsilon_cents?: number } {
  const base = (row?.thresholds as Record<string, number>) || {};
  return { ...base, ...overrides };
}

async function insertRptToken(params: {
  abn: string;
  taxType: string;
  periodId: string;
  payload: RptPayload;
  signature: string;
  payloadC14n: string;
  payloadSha256: string;
  nonce: string;
  expiresAt: string;
}) {
  const values = [
    params.abn,
    params.taxType,
    params.periodId,
    params.payload,
    params.signature,
    params.payloadC14n,
    params.payloadSha256,
    params.nonce,
    params.expiresAt,
  ];

  const insertWithNonce = `
    INSERT INTO rpt_tokens
      (abn, tax_type, period_id, payload, signature, payload_c14n, payload_sha256, nonce, expires_at)
    VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9)
  `;

  const insertFallback = `
    INSERT INTO rpt_tokens
      (abn, tax_type, period_id, payload, signature, payload_c14n, payload_sha256)
    VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7)
  `;

  try {
    await pool.query(insertWithNonce, values);
  } catch (err: any) {
    if (err?.message && /column "(nonce|expires_at)"/i.test(err.message)) {
      await pool.query(insertFallback, values.slice(0, 7));
    } else {
      throw err;
    }
  }
}

export async function issueRPT(
  abn: string,
  taxType: "PAYGW" | "GST",
  periodId: string,
  thresholds: Record<string, number>,
) {
  const { rows } = await pool.query(
    `SELECT id, state, anomaly_vector, thresholds, final_liability_cents, credited_to_owa_cents,
            merkle_root, running_balance_hash
       FROM periods WHERE abn=$1 AND tax_type=$2 AND period_id=$3
       LIMIT 1`,
    [abn, taxType, periodId],
  );
  if (!rows.length) throw new Error("PERIOD_NOT_FOUND");
  const row = rows[0];
  if (row.state !== "CLOSING") throw new Error("BAD_STATE");

  const mergedThresholds = mergeThresholds(row, thresholds);
  const anomalyVector = anomalyFromRow(row);
  if (isAnomalous(anomalyVector, mergedThresholds)) {
    await pool.query(`UPDATE periods SET state='BLOCKED_ANOMALY' WHERE id=$1`, [row.id]);
    throw new Error("BLOCKED_ANOMALY");
  }

  const epsilonLimit = asNumber((mergedThresholds as any).epsilon_cents);
  const liability = asNumber(row.final_liability_cents);
  const credited = asNumber(row.credited_to_owa_cents);
  if (epsilonLimit && Math.abs(liability - credited) > epsilonLimit) {
    await pool.query(`UPDATE periods SET state='BLOCKED_DISCREPANCY' WHERE id=$1`, [row.id]);
    throw new Error("BLOCKED_DISCREPANCY");
  }

  const nonce = crypto.randomUUID();
  const expiryIso = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  const payload: RptPayload = {
    entity_id: abn,
    period_id: periodId,
    tax_type: taxType,
    amount_cents: liability,
    merkle_root: row.merkle_root,
    running_balance_hash: row.running_balance_hash,
    anomaly_vector: anomalyVector,
    thresholds: mergedThresholds,
    rail_id: "EFT",
    reference: process.env.ATO_PRN || "",
    expiry_ts: expiryIso,
    nonce,
  };

  const payloadC14n = canonicalJson(payload);
  const payloadSha256 = crypto.createHash("sha256").update(payloadC14n).digest("hex");
  const signature = signRpt(payload, loadSecretKey());

  await insertRptToken({
    abn,
    taxType,
    periodId,
    payload,
    signature,
    payloadC14n,
    payloadSha256,
    nonce,
    expiresAt: expiryIso,
  });

  await pool.query(`UPDATE periods SET state='READY_RPT' WHERE id=$1`, [row.id]);
  return { payload, signature, payload_c14n: payloadC14n, payload_sha256: payloadSha256 };
}
