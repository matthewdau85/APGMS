import { Pool } from "pg";
import crypto from "crypto";
import { exceeds } from "../anomaly/deterministic";
import { RptPayload } from "../crypto/ed25519";
import { getCanonicalPayload, signRpt as signRptWithKms } from "../crypto/kms";
import { FEATURE_ATO_TABLES, RATES_VERSION, RPT_TTL_SECONDS } from "./config";

const pool = new Pool();

export async function issueRPT(
  abn: string,
  taxType: "PAYGW" | "GST",
  periodId: string,
  thresholds: Record<string, number>,
) {
  const p = await pool.query(
    "select * from periods where abn= and tax_type= and period_id=",
    [abn, taxType, periodId],
  );
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

  const expiryMs = Date.now() + RPT_TTL_SECONDS * 1000;
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
    expiry_ts: new Date(expiryMs).toISOString(),
    nonce: crypto.randomUUID(),
    rates_version: RATES_VERSION,
  };

  const signature = await signRptWithKms(payload);
  const payloadC14n = getCanonicalPayload(payload);
  const payloadSha256 = crypto.createHash("sha256").update(payloadC14n).digest("hex");

  if (FEATURE_ATO_TABLES) {
    await pool.query(
      "insert into rpt_tokens(abn,tax_type,period_id,payload,signature,payload_c14n,payload_sha256) values ($1,$2,$3,$4,$5,$6,$7)",
      [abn, taxType, periodId, payload, signature, payloadC14n, payloadSha256],
    );
  } else {
    await pool.query(
      "insert into rpt_tokens(abn,tax_type,period_id,payload,signature) values ($1,$2,$3,$4,$5)",
      [abn, taxType, periodId, payload, signature],
    );
  }

  await pool.query("update periods set state='READY_RPT' where id=", [row.id]);
  return { payload, signature };
}
