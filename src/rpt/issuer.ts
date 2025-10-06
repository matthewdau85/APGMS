import { PoolClient } from "pg";
import crypto from "crypto";
import { signRpt, RptPayload } from "../crypto/ed25519";
import { exceeds } from "../anomaly/deterministic";

const secretKey = Buffer.from(process.env.RPT_ED25519_SECRET_BASE64 || "", "base64");

export type IssueRptParams = {
  abn: string;
  taxType: "PAYGW" | "GST";
  periodId: string;
  head: string;
  ratesVersion: string;
  thresholds?: Record<string, number>;
};

export async function issueRPT(client: PoolClient, params: IssueRptParams) {
  const { abn, taxType, periodId, head, ratesVersion } = params;
  const periodQuery = await client.query(
    "select * from periods where abn=$1 and tax_type=$2 and period_id=$3 for update",
    [abn, taxType, periodId]
  );
  if (periodQuery.rowCount === 0) throw new Error("PERIOD_NOT_FOUND");
  const row = periodQuery.rows[0];
  if (row.state !== "CLOSING") throw new Error("BAD_STATE");

  const persistedThresholds = row.thresholds || {};
  const thresholds = { ...persistedThresholds, ...(params.thresholds || {}) } as Record<string, number>;
  const anomalyVector = row.anomaly_vector || {};

  if (exceeds(anomalyVector, thresholds)) {
    await client.query("update periods set state='BLOCKED_ANOMALY' where id=$1", [row.id]);
    throw new Error("BLOCKED_ANOMALY");
  }
  const epsilon = Math.abs(Number(row.final_liability_cents) - Number(row.credited_to_owa_cents));
  const epsilonLimit = thresholds["epsilon_cents"] ?? 0;
  if (epsilon > epsilonLimit) {
    await client.query("update periods set state='BLOCKED_DISCREPANCY' where id=$1", [row.id]);
    throw new Error("BLOCKED_DISCREPANCY");
  }

  const payload: RptPayload = {
    entity_id: row.abn,
    period_id: row.period_id,
    tax_type: row.tax_type,
    amount_cents: Number(row.final_liability_cents),
    merkle_root: row.merkle_root,
    running_balance_hash: head || row.running_balance_hash,
    anomaly_vector: anomalyVector,
    thresholds,
    rail_id: "EFT",
    reference: process.env.ATO_PRN || "",
    expiry_ts: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    nonce: crypto.randomUUID(),
    rates_version: ratesVersion
  };

  const signature = signRpt(payload, new Uint8Array(secretKey));
  await client.query(
    "insert into rpt_tokens(abn,tax_type,period_id,payload,signature) values ($1,$2,$3,$4,$5)",
    [abn, taxType, periodId, payload, signature]
  );
  await client.query("update periods set state='READY_RPT' where id=$1", [row.id]);
  return { payload, signature };
}
