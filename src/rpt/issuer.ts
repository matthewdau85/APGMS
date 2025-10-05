import { PoolClient } from "pg";
import crypto from "crypto";
import { signRpt, RptPayload } from "../crypto/ed25519";
import { exceeds } from "../anomaly/deterministic";
import { getRunner } from "../db/pool";

const secretKey = Buffer.from(process.env.RPT_ED25519_SECRET_BASE64 || "", "base64");

type Thresholds = Record<string, number>;

export async function issueRPT(
  abn: string,
  taxType: "PAYGW" | "GST",
  periodId: string,
  thresholds: Thresholds,
  client?: PoolClient
) {
  const runner = getRunner(client);
  const p = await runner.query(
    `SELECT * FROM periods WHERE abn=$1 AND tax_type=$2 AND period_id=$3`,
    [abn, taxType, periodId]
  );
  if (p.rowCount === 0) throw new Error("PERIOD_NOT_FOUND");
  const row = p.rows[0];
  if (row.state !== "CLOSING") throw new Error("BAD_STATE");

  const v = row.anomaly_vector || {};
  if (exceeds(v, thresholds)) {
    await runner.query(`UPDATE periods SET state='BLOCKED_ANOMALY' WHERE id=$1`, [row.id]);
    throw new Error("BLOCKED_ANOMALY");
  }
  const epsilon = Math.abs(Number(row.final_liability_cents) - Number(row.credited_to_owa_cents));
  if (epsilon > (thresholds["epsilon_cents"] ?? 0)) {
    await runner.query(`UPDATE periods SET state='BLOCKED_DISCREPANCY' WHERE id=$1`, [row.id]);
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
    nonce: crypto.randomUUID()
  };
  const signature = signRpt(payload, new Uint8Array(secretKey));
  await runner.query(
    `INSERT INTO rpt_tokens(abn,tax_type,period_id,payload,signature) VALUES ($1,$2,$3,$4,$5)`,
    [abn, taxType, periodId, payload, signature]
  );
  await runner.query(`UPDATE periods SET state='READY_RPT' WHERE id=$1`, [row.id]);
  return { payload, signature };
}
