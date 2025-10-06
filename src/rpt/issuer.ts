import crypto from "crypto";
import { q, tx } from "../db";
import { signRpt, RptPayload } from "../crypto/ed25519";
import { exceeds } from "../anomaly/deterministic";

const secretKey = Buffer.from(process.env.RPT_ED25519_SECRET_BASE64 || "", "base64");

export const SQL_SELECT_PERIOD =
  "SELECT * FROM periods WHERE abn=$1 AND tax_type=$2 AND period_id=$3";
export const SQL_MARK_BLOCKED_ANOMALY =
  "UPDATE periods SET state='BLOCKED_ANOMALY' WHERE id=$1";
export const SQL_MARK_BLOCKED_DISCREPANCY =
  "UPDATE periods SET state='BLOCKED_DISCREPANCY' WHERE id=$1";
export const SQL_INSERT_RPT_TOKEN =
  "INSERT INTO rpt_tokens(abn,tax_type,period_id,payload,signature) VALUES ($1,$2,$3,$4,$5)";
export const SQL_MARK_READY_RPT =
  "UPDATE periods SET state='READY_RPT' WHERE id=$1";

export async function issueRPT(
  abn: string,
  taxType: "PAYGW" | "GST",
  periodId: string,
  thresholds: Record<string, number>
) {
  const period = await q(SQL_SELECT_PERIOD, [abn, taxType, periodId]);
  if (period.rowCount === 0) throw new Error("PERIOD_NOT_FOUND");
  const row = period.rows[0];
  if (row.state !== "CLOSING") throw new Error("BAD_STATE");

  const v = row.anomaly_vector || {};
  if (exceeds(v, thresholds)) {
    await q(SQL_MARK_BLOCKED_ANOMALY, [row.id]);
    throw new Error("BLOCKED_ANOMALY");
  }
  const epsilon = Math.abs(Number(row.final_liability_cents) - Number(row.credited_to_owa_cents));
  if (epsilon > (thresholds["epsilon_cents"] ?? 0)) {
    await q(SQL_MARK_BLOCKED_DISCREPANCY, [row.id]);
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
  const signature = signRpt(payload, new Uint8Array(secretKey));

  await tx(async (client) => {
    await client.query(SQL_INSERT_RPT_TOKEN, [abn, taxType, periodId, payload, signature]);
    await client.query(SQL_MARK_READY_RPT, [row.id]);
  });

  return { payload, signature };
}
