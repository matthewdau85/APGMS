import crypto from "crypto";
import pool from "../db/pool.js";
import { signRpt, RptPayload } from "../crypto/ed25519";
import { exceeds } from "../anomaly/deterministic";

export const SQL_SELECT_PERIOD_FOR_RPT = `
  SELECT *
  FROM periods
  WHERE abn = $1
    AND tax_type = $2
    AND period_id = $3
`;

export const SQL_UPDATE_PERIOD_STATE = `
  UPDATE periods
     SET state = $1
   WHERE id = $2
`;

export const SQL_INSERT_RPT_TOKEN = `
  INSERT INTO rpt_tokens (abn, tax_type, period_id, payload, signature)
  VALUES ($1, $2, $3, $4, $5)
`;

const secretKey = Buffer.from(process.env.RPT_ED25519_SECRET_BASE64 || "", "base64");

function httpError(message: string, status: number) {
  const err = new Error(message) as Error & { status: number };
  (err as any).status = status;
  return err;
}

export async function issueRPT(
  abn: string,
  taxType: "PAYGW" | "GST",
  periodId: string,
  thresholds: Record<string, number>
) {
  const p = await pool.query(SQL_SELECT_PERIOD_FOR_RPT, [abn, taxType, periodId]);
  if (p.rowCount === 0) throw httpError("PERIOD_NOT_FOUND", 404);
  const row = p.rows[0];
  if (row.state !== "CLOSING") throw httpError("BAD_STATE", 409);

  const v = row.anomaly_vector || {};
  if (exceeds(v, thresholds)) {
    await pool.query(SQL_UPDATE_PERIOD_STATE, ["BLOCKED_ANOMALY", row.id]);
    throw httpError("BLOCKED_ANOMALY", 409);
  }
  const epsilon = Math.abs(Number(row.final_liability_cents) - Number(row.credited_to_owa_cents));
  if (epsilon > (thresholds["epsilon_cents"] ?? 0)) {
    await pool.query(SQL_UPDATE_PERIOD_STATE, ["BLOCKED_DISCREPANCY", row.id]);
    throw httpError("BLOCKED_DISCREPANCY", 409);
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
    nonce: crypto.randomUUID()
  };
  const signature = signRpt(payload, new Uint8Array(secretKey));
  await pool.query(SQL_INSERT_RPT_TOKEN, [abn, taxType, periodId, payload, signature]);
  await pool.query(SQL_UPDATE_PERIOD_STATE, ["READY_RPT", row.id]);
  return { payload, signature };
}
