import crypto from "crypto";
import { pool } from "../db/pool";
import {
  insertRptToken,
  selectPeriodByKey,
  updatePeriodStateById,
} from "../db/queries";
import { sha256Hex } from "../crypto/merkle";
import { signRpt, RptPayload } from "../crypto/ed25519";
import { exceeds } from "../anomaly/deterministic";

const secretKey = Buffer.from(process.env.RPT_ED25519_SECRET_BASE64 || "", "base64");

export async function issueRPT(
  abn: string,
  taxType: "PAYGW" | "GST",
  periodId: string,
  thresholds: Record<string, number>,
) {
  const p = await pool.query(selectPeriodByKey(abn, taxType, periodId));
  if (p.rowCount === 0) throw new Error("PERIOD_NOT_FOUND");
  const row = p.rows[0];
  if (row.state !== "CLOSING") throw new Error("BAD_STATE");

  const v = row.anomaly_vector || {};
  if (exceeds(v, thresholds)) {
    await pool.query(updatePeriodStateById(row.id, "BLOCKED_ANOMALY"));
    throw new Error("BLOCKED_ANOMALY");
  }
  const epsilon = Math.abs(Number(row.final_liability_cents) - Number(row.credited_to_owa_cents));
  if (epsilon > (thresholds["epsilon_cents"] ?? 0)) {
    await pool.query(updatePeriodStateById(row.id, "BLOCKED_DISCREPANCY"));
    throw new Error("BLOCKED_DISCREPANCY");
  }

  const nonce = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

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
    expiry_ts: expiresAt.toISOString(),
    nonce,
  };
  const signature = signRpt(payload, new Uint8Array(secretKey));
  const payloadStr = JSON.stringify(payload);
  const payloadSha256 = sha256Hex(payloadStr);
  await pool.query(insertRptToken({
    abn,
    taxType,
    periodId,
    payload,
    signature,
    payloadC14n: payloadStr,
    payloadSha256,
    nonce,
    expiresAt,
  }));
  await pool.query(updatePeriodStateById(row.id, "READY_RPT"));
  return { payload, signature };
}
