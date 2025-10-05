import { Pool } from "pg";
import crypto from "crypto";
import { RptPayload } from "../crypto/ed25519";
import { providerRegistry } from "@core/providerRegistry";

const pool = new Pool();
const DEFAULT_SIGNING_ALIAS = process.env.RPT_SIGNING_KEY_ALIAS || "RPT_ED25519_SECRET";

export async function issueRPT(
  abn: string,
  taxType: "PAYGW" | "GST",
  periodId: string,
  thresholds: Record<string, number>
) {
  const p = await pool.query("select * from periods where abn=$1 and tax_type=$2 and period_id=$3", [abn, taxType, periodId]);
  if (p.rowCount === 0) throw new Error("PERIOD_NOT_FOUND");
  const row = p.rows[0];
  if (row.state !== "CLOSING") throw new Error("BAD_STATE");

  const anomalyProvider = providerRegistry.get("anomaly");
  const kmsProvider = providerRegistry.get("kms");

  const v = row.anomaly_vector || {};
  const decision = await anomalyProvider.evaluate(v, thresholds);
  if (decision.anomalous) {
    await pool.query("update periods set state='BLOCKED_ANOMALY' where id=$1", [row.id]);
    throw new Error("BLOCKED_ANOMALY");
  }
  const epsilon = Math.abs(Number(row.final_liability_cents) - Number(row.credited_to_owa_cents));
  if (epsilon > (thresholds["epsilon_cents"] ?? 0)) {
    await pool.query("update periods set state='BLOCKED_DISCREPANCY' where id=$1", [row.id]);
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

  const message = new TextEncoder().encode(JSON.stringify(payload));
  const { signature } = await kmsProvider.signEd25519(DEFAULT_SIGNING_ALIAS, message);
  const signatureB64 = Buffer.from(signature).toString("base64url");

  await pool.query(
    "insert into rpt_tokens(abn,tax_type,period_id,payload,signature) values ($1,$2,$3,$4,$5)",
    [abn, taxType, periodId, payload, signatureB64]
  );
  await pool.query("update periods set state='READY_RPT' where id=$1", [row.id]);
  return { payload, signature: signatureB64 };
}
