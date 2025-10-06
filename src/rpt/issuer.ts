import crypto from "crypto";
import { signRpt, RptPayload } from "../crypto/ed25519";
import { sha256Hex } from "../crypto/merkle";
import { getPool } from "../db/pool";
import { canonicalJson } from "../utils/json";
import { RATES_VERSION, RPT_KID, RPT_TTL_SECONDS } from "./constants";

const pool = getPool();
const secretKeyB64 = process.env.RPT_ED25519_SECRET_BASE64 || "";
const secretKey = secretKeyB64 ? Buffer.from(secretKeyB64, "base64") : Buffer.alloc(0);

export async function issueRPT(
  abn: string,
  taxType: "PAYGW" | "GST",
  periodId: string,
  thresholds: Record<string, number>
) {
  if (!secretKey.length) {
    throw new Error("NO_RPT_SECRET");
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      "select * from periods where abn=$1 and tax_type=$2 and period_id=$3 for update",
      [abn, taxType, periodId]
    );
    if (!rows.length) {
      throw new Error("PERIOD_NOT_FOUND");
    }
    const period = rows[0];
    if (period.state !== "RECON_OK") {
      throw new Error("BAD_STATE");
    }

    await client.query(
      "update rpt_tokens set status='expired' where abn=$1 and tax_type=$2 and period_id=$3 and status='active'",
      [abn, taxType, periodId]
    );

    const expiry = new Date(Date.now() + RPT_TTL_SECONDS * 1000);
    const nonce = crypto.randomUUID();
    const payload: RptPayload = {
      entity_id: period.abn,
      period_id: period.period_id,
      tax_type: period.tax_type,
      amount_cents: Number(period.final_liability_cents ?? 0),
      merkle_root: period.merkle_root || "",
      running_balance_hash: period.running_balance_hash || "",
      anomaly_vector: period.anomaly_vector || {},
      thresholds,
      rail_id: "EFT",
      reference: process.env.ATO_PRN || "",
      expiry_ts: expiry.toISOString(),
      nonce,
    };

    const payloadC14n = canonicalJson(payload);
    const payloadSha = sha256Hex(payloadC14n);
    const signature = signRpt(payload, new Uint8Array(secretKey));

    await client.query(
      "insert into rpt_tokens(abn,tax_type,period_id,payload,signature,payload_c14n,payload_sha256,rates_version,kid,exp,nonce,status) values ($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9,$10,$11,$12)",
      [
        abn,
        taxType,
        periodId,
        JSON.stringify(payload),
        signature,
        payloadC14n,
        payloadSha,
        RATES_VERSION,
        RPT_KID,
        expiry.toISOString(),
        nonce,
        "active",
      ]
    );

    await client.query("update periods set state=$1 where id=$2", ["READY_RPT", period.id]);
    await client.query("COMMIT");

    return {
      payload,
      signature,
      kid: RPT_KID,
      rates_version: RATES_VERSION,
      exp: expiry.toISOString(),
      nonce,
    };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
