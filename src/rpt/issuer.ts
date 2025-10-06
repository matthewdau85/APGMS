import { Pool } from "pg";
import { createHash, randomUUID } from "crypto";
import { RptPayload, signRptPayload } from "../crypto/rptSigner";
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
    nonce: randomUUID(),
    rates_version: row.rates_version ?? "baseline",
  };

  const signed = await signRptPayload(payload);
  const { token, signature, canonical } = signed;
  const sha256 = createHash("sha256").update(canonical).digest("hex");

  await pool.query(
    "insert into rpt_tokens(abn,tax_type,period_id,payload_json,payload_c14n,payload_sha256,sig_ed25519,key_id) values ($1,$2,$3,$4,$5,$6,$7,$8)",
    [abn, taxType, periodId, token, canonical, sha256, signature, token.kid]
  );
  await pool.query("update periods set state='READY_RPT' where id=", [row.id]);
  return { rpt: token, signature };
}
