import { Pool, PoolClient } from "pg";
import crypto from "crypto";
import { signRpt, RptPayload } from "../crypto/ed25519";

const pool = new Pool();
const secretKeyBase64 = process.env.RPT_ED25519_SECRET_BASE64 || "";

export interface IssueResult {
  payload: RptPayload;
  signature: string;
  payload_sha256: string;
}

export async function issueRPT(
  abn: string,
  taxType: "PAYGW" | "GST",
  periodId: string,
  payload: RptPayload,
  client?: PoolClient
): Promise<IssueResult> {
  if (!secretKeyBase64) {
    throw new Error("RPT_SECRET_UNAVAILABLE");
  }

  const signer = client ?? (await pool.connect());
  try {
    const payloadStr = JSON.stringify(payload);
    const secretKey = Buffer.from(secretKeyBase64, "base64");
    const signature = signRpt(payload, new Uint8Array(secretKey));
    const payloadSha256 = crypto
      .createHash("sha256")
      .update(payloadStr)
      .digest("hex");

    await signer.query(
      `insert into rpt_tokens(abn,tax_type,period_id,payload,signature,payload_c14n,payload_sha256)
       values ($1,$2,$3,$4::jsonb,$5,$6,$7)`,
      [abn, taxType, periodId, payloadStr, signature, payloadStr, payloadSha256]
    );

    return { payload, signature, payload_sha256: payloadSha256 };
  } finally {
    if (!client) {
      signer.release();
    }
  }
}
