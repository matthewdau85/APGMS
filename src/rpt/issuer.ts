import { Pool } from "pg";
import crypto from "crypto";
import { sign, getActiveKid } from "../crypto/kms";
import { exceeds } from "../anomaly/deterministic";
const pool = new Pool();

export async function issueRPT(abn: string, taxType: "PAYGW"|"GST", periodId: string, thresholds: Record<string, number>) {
  const p = await pool.query("select * from periods where abn= and tax_type= and period_id=", [abn, taxType, periodId]);
  if (p.rowCount === 0) throw new Error("PERIOD_NOT_FOUND");
  const row = p.rows[0];
  if (row.state !== "CLOSING") throw new Error("BAD_STATE");

  const v = row.anomaly_vector || {};
  if (exceeds(v, thresholds)) {
    await pool.query("update periods set state='BLOCKED_ANOMALY' where id=", [row.id]);
    throw new Error("BLOCKED_ANOMALY");
  }
  const epsilon = Math.abs(Number(row.final_liability_cents) - Number(row.credited_to_owa_cents));
  if (epsilon > (thresholds["epsilon_cents"] ?? 0)) {
    await pool.query("update periods set state='BLOCKED_DISCREPANCY' where id=", [row.id]);
    throw new Error("BLOCKED_DISCREPANCY");
  }

  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + 15 * 60 * 1000);
  const ratesVersion = process.env.RATES_VERSION || process.env.RPT_RATES_VERSION || "default";
  const kid = await getActiveKid();

  const payload = {
    entity_id: row.abn,
    period_id: row.period_id,
    tax_type: row.tax_type,
    amount_cents: Number(row.final_liability_cents),
    merkle_root: row.merkle_root,
    running_balance_hash: row.running_balance_hash,
    anomaly_vector: v,
    thresholds,
    rail_id: "EFT" as const,
    reference: process.env.ATO_PRN || "",
    exp: expiresAt.toISOString(),
    issued_at: issuedAt.toISOString(),
    nonce: crypto.randomUUID(),
    kid,
    rates_version: ratesVersion,
  };

  const payloadJson = JSON.stringify(payload);
  const signed = await sign(new TextEncoder().encode(payloadJson), kid);
  const signature = Buffer.from(signed.signature).toString("base64url");

  await pool.query("insert into rpt_tokens(abn,tax_type,period_id,payload,signature) values (,,,,)",
    [abn, taxType, periodId, payload, signature]);
  await pool.query("update periods set state='READY_RPT' where id=", [row.id]);
  return { payload, signature };
}
