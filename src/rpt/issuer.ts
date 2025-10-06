import type { PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import { sha256Hex } from "../crypto/merkle";
import {
  CanonicalRptPayload,
  canonicalizeRpt,
  secretKeyFromBase64,
  signCanonicalRpt,
} from "../crypto/ed25519";

export interface IssueRptInput {
  client: PoolClient;
  abn: string;
  taxType: "PAYGW" | "GST";
  periodId: string;
  totals: Record<string, unknown>;
  ratesVersion: string;
  expirySeconds?: number;
}

export interface IssueRptResult {
  payload: CanonicalRptPayload;
  signature: string;
  payloadSha256: string;
  canonical: string;
  rptId: number;
}

export async function issueRptToken(input: IssueRptInput): Promise<IssueRptResult> {
  const { client, abn, taxType, periodId, totals, ratesVersion } = input;

  const nonce = randomUUID();
  const exp = new Date(Date.now() + (input.expirySeconds ?? 15 * 60) * 1000).toISOString();

  const payload: CanonicalRptPayload = {
    abn,
    tax_type: taxType,
    period_id: periodId,
    totals,
    rates_version: ratesVersion,
    nonce,
    exp,
  };

  const canonical = canonicalizeRpt(payload);
  const secretKey = secretKeyFromBase64(process.env.RPT_ED25519_SECRET_BASE64);
  const signature = signCanonicalRpt(canonical, secretKey);
  const payloadSha256 = sha256Hex(canonical);

  const insert = await client.query(
    `INSERT INTO rpt_tokens (abn,tax_type,period_id,payload,signature,payload_c14n,payload_sha256,status)
     VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,'active')
     RETURNING id`,
    [abn, taxType, periodId, payload, signature, canonical, payloadSha256]
  );

  return { payload, signature, payloadSha256, canonical, rptId: insert.rows[0].id };
}
