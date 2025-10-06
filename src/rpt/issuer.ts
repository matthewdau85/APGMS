import { Pool } from "pg";
import crypto from "crypto";
import { signRpt, RptPayload } from "../crypto/ed25519";
import { exceeds } from "../anomaly/deterministic";
import { loadRptSigningKey } from "../crypto/keyManager";

export interface IssueContext {
  actorId: string;
  actorRoles: string[];
  requestId?: string;
  requestIp?: string;
}
const pool = new Pool();

export async function issueRPT(
  abn: string,
  taxType: "PAYGW" | "GST",
  periodId: string,
  thresholds: Record<string, number>,
  context: IssueContext,
) {
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

  const payload: RptPayload = {
    entity_id: row.abn, period_id: row.period_id, tax_type: row.tax_type,
    amount_cents: Number(row.final_liability_cents),
    merkle_root: row.merkle_root, running_balance_hash: row.running_balance_hash,
    anomaly_vector: v, thresholds, rail_id: "EFT", reference: process.env.ATO_PRN || "",
    expiry_ts: new Date(Date.now() + 15*60*1000).toISOString(), nonce: crypto.randomUUID()
  };
  const { key, keyId } = loadRptSigningKey();
  const signature = signRpt(payload, key);
  await pool.query("insert into rpt_tokens(abn,tax_type,period_id,payload,signature,kms_key_id,issued_by,issued_request_id,issued_ip) values (,,,,,,,,)",
    [abn, taxType, periodId, payload, signature, keyId, context.actorId, context.requestId, context.requestIp]);
  await pool.query("update periods set state='READY_RPT' where id=", [row.id]);
  return { payload, signature };
}
