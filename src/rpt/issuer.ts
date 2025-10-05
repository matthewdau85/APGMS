import { Pool } from "pg";
import crypto from "crypto";
import { signRpt, RptPayload } from "../crypto/ed25519";
import { AnomalyVector, Thresholds as AnomalyThresholds, isAnomalous, isVectorAnomalous } from "../anomaly";
const pool = new Pool();
const secretKey = Buffer.from(process.env.RPT_ED25519_SECRET_BASE64 || "", "base64");

export async function issueRPT(abn: string, taxType: "PAYGW"|"GST", periodId: string, thresholds: Record<string, number>) {
  const p = await pool.query("select * from periods where abn= and tax_type= and period_id=", [abn, taxType, periodId]);
  if (p.rowCount === 0) throw new Error("PERIOD_NOT_FOUND");
  const row = p.rows[0];
  if (row.state !== "CLOSING") throw new Error("BAD_STATE");

  const deltaCents = Number(row.final_liability_cents) - Number(row.credited_to_owa_cents);
  const toleranceBps = thresholds["tolerance_bps"] ?? 0;
  if (isAnomalous(deltaCents, Number(row.final_liability_cents), toleranceBps)) {
    throw new Error("TOLERANCE_EXCEEDED");
  }

  const vector: AnomalyVector = {
    variance_ratio: Number(row.anomaly_vector?.variance_ratio ?? 0),
    dup_rate: Number(row.anomaly_vector?.dup_rate ?? 0),
    gap_minutes: Number(row.anomaly_vector?.gap_minutes ?? 0),
    delta_vs_baseline: Number(row.anomaly_vector?.delta_vs_baseline ?? 0),
  };
  const anomalyThresholds: AnomalyThresholds = {
    variance_ratio: thresholds["variance_ratio"],
    dup_rate: thresholds["dup_rate"],
    gap_minutes: thresholds["gap_minutes"],
    delta_vs_baseline: thresholds["delta_vs_baseline"],
  };

  if (isVectorAnomalous(vector, anomalyThresholds)) {
    await pool.query("update periods set state='BLOCKED_ANOMALY' where id=", [row.id]);
    throw new Error("BLOCKED_ANOMALY");
  }
  const epsilon = Math.abs(deltaCents);
  if (epsilon > (thresholds["epsilon_cents"] ?? 0)) {
    await pool.query("update periods set state='BLOCKED_DISCREPANCY' where id=", [row.id]);
    throw new Error("BLOCKED_DISCREPANCY");
  }

  const payload: RptPayload = {
    entity_id: row.abn, period_id: row.period_id, tax_type: row.tax_type,
    amount_cents: Number(row.final_liability_cents),
    merkle_root: row.merkle_root, running_balance_hash: row.running_balance_hash,
    anomaly_vector: vector,
    thresholds,
    rail_id: "EFT",
    reference: process.env.ATO_PRN || "",
    expiry_ts: new Date(Date.now() + 15*60*1000).toISOString(), nonce: crypto.randomUUID()
  };
  const signature = signRpt(payload, new Uint8Array(secretKey));
  await pool.query("insert into rpt_tokens(abn,tax_type,period_id,payload,signature) values (,,,,)",
    [abn, taxType, periodId, payload, signature]);
  await pool.query("update periods set state='READY_RPT' where id=", [row.id]);
  return { payload, signature };
}
