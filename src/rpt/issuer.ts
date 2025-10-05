import { Pool } from "pg";
import crypto from "crypto";
import { signRpt, RptPayload } from "../crypto/ed25519";
import { HttpError } from "../errors";

const pool = new Pool();
const secretKey = Buffer.from(process.env.RPT_ED25519_SECRET_BASE64 || "", "base64");

function anomalyExceeds(v: Record<string, number>, thresholds: Record<string, number>): boolean {
  const variance = Number(v?.["variance_ratio"] ?? 0);
  const dup = Number(v?.["dup_rate"] ?? 0);
  const gap = Number(v?.["gap_minutes"] ?? 0);
  const delta = Number(v?.["delta_vs_baseline"] ?? 0);
  const varianceThreshold = thresholds["variance_ratio"];
  const dupThreshold = thresholds["dup_rate"];
  const gapThreshold = thresholds["gap_minutes"];
  const deltaThreshold = thresholds["delta_vs_baseline"];
  return (
    (varianceThreshold !== undefined && variance > varianceThreshold) ||
    (dupThreshold !== undefined && dup > dupThreshold) ||
    (gapThreshold !== undefined && gap > gapThreshold) ||
    (deltaThreshold !== undefined && Math.abs(delta) > deltaThreshold)
  );
}

export async function issueRPT(abn: string, taxType: "PAYGW"|"GST", periodId: string, thresholds: Record<string, number>) {
  const p = await pool.query(
    "select * from periods where abn=$1 and tax_type=$2 and period_id=$3",
    [abn, taxType, periodId]
  );
  if (p.rowCount === 0) {
    throw new HttpError(404, "PERIOD_NOT_FOUND", { abn, taxType, periodId });
  }
  const row = p.rows[0];
  if (row.state !== "CLOSING") {
    throw new HttpError(409, "BAD_STATE", { state: row.state });
  }

  const v = row.anomaly_vector || {};
  if (anomalyExceeds(v, thresholds)) {
    await pool.query("update periods set state='BLOCKED_ANOMALY' where id=$1", [row.id]);
    throw new HttpError(409, "BLOCKED_ANOMALY");
  }
  const epsilon = Math.abs(Number(row.final_liability_cents) - Number(row.credited_to_owa_cents));
  if (epsilon > (thresholds["epsilon_cents"] ?? 0)) {
    await pool.query("update periods set state='BLOCKED_DISCREPANCY' where id=$1", [row.id]);
    throw new HttpError(409, "BLOCKED_DISCREPANCY", { epsilon });
  }

  if (secretKey.length === 0) {
    throw new HttpError(500, "RPT_SIGNING_DISABLED");
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
  await pool.query(
    "insert into rpt_tokens(abn,tax_type,period_id,payload,signature) values ($1,$2,$3,$4,$5)",
    [abn, taxType, periodId, payload, signature]
  );
  await pool.query("update periods set state='READY_RPT' where id=$1", [row.id]);
  return { payload, signature };
}
