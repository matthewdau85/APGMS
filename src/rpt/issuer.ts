import { Pool, PoolClient } from "pg";
import crypto from "crypto";
import nacl from "tweetnacl";
import { exceeds } from "../anomaly/deterministic";
import { sha256Hex } from "../crypto/merkle";
import type { PeriodTotals } from "../tax/engine";

const pool = new Pool();

interface IssueRPTOptions {
  abn: string;
  taxType: "PAYGW" | "GST";
  periodId: string;
  liabilityCents: number;
  ratesVersion: string;
  merkleRoot: string | null;
  runningBalanceHash: string | null;
  totals: PeriodTotals;
  thresholds: Record<string, number>;
  anomalyVector: Record<string, number>;
  creditedToOwaCents: number;
  periodState: string;
  periodRowId?: number;
}

function canonicalize(value: any): any {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const out: Record<string, any> = {};
    Object.keys(value).sort().forEach(k => {
      out[k] = canonicalize(value[k]);
    });
    return out;
  }
  return value;
}

function canonicalJson(obj: any): string {
  return JSON.stringify(canonicalize(obj));
}

let signingKey: Uint8Array | null = null;

function loadSigningKey(): Uint8Array {
  if (signingKey) return signingKey;
  const secretB64 = process.env.RPT_ED25519_SECRET_BASE64 || "";
  if (!secretB64) throw new Error("NO_SIGNING_KEY");
  const raw = Buffer.from(secretB64, "base64");
  if (raw.length === 64) {
    signingKey = new Uint8Array(raw);
    return signingKey;
  }
  if (raw.length === 32) {
    const pair = nacl.sign.keyPair.fromSeed(new Uint8Array(raw));
    signingKey = pair.secretKey;
    return signingKey;
  }
  throw new Error("RPT_ED25519_SECRET_BASE64 must be 32-byte seed or 64-byte secret key");
}

function ensureRptColumns(client: PoolClient) {
  const alters = [
    "ALTER TABLE rpt_tokens ADD COLUMN IF NOT EXISTS payload_c14n text",
    "ALTER TABLE rpt_tokens ADD COLUMN IF NOT EXISTS payload_sha256 text",
    "ALTER TABLE rpt_tokens ADD COLUMN IF NOT EXISTS nonce text",
    "ALTER TABLE rpt_tokens ADD COLUMN IF NOT EXISTS expires_at timestamptz",
    "ALTER TABLE rpt_tokens ADD COLUMN IF NOT EXISTS kid text",
    "ALTER TABLE rpt_tokens ADD COLUMN IF NOT EXISTS rates_version text",
    "ALTER TABLE rpt_tokens ADD COLUMN IF NOT EXISTS consumed_at timestamptz"
  ];
  return Promise.all(alters.map(sql => client.query(sql)));
}

export async function issueRPT(client: PoolClient, opts: IssueRPTOptions) {
  await ensureRptColumns(client);

  if (opts.periodState !== "CLOSING") {
    throw new Error("BAD_STATE");
  }

  if (exceeds(opts.anomalyVector || {}, opts.thresholds || {})) {
    if (opts.periodRowId) {
      await client.query("UPDATE periods SET state='BLOCKED_ANOMALY' WHERE id=$1", [opts.periodRowId]);
    }
    throw new Error("BLOCKED_ANOMALY");
  }

  const epsilon = Math.abs(Number(opts.liabilityCents) - Number(opts.creditedToOwaCents || 0));
  if (epsilon > (opts.thresholds?.epsilon_cents ?? 0)) {
    if (opts.periodRowId) {
      await client.query("UPDATE periods SET state='BLOCKED_DISCREPANCY' WHERE id=$1", [opts.periodRowId]);
    }
    throw new Error("BLOCKED_DISCREPANCY");
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + 15 * 60 * 1000);
  const nonce = crypto.randomUUID();

  const payload = {
    version: "apgms.rpt.v1",
    abn: opts.abn,
    tax_type: opts.taxType,
    period_id: opts.periodId,
    liability_cents: Number(opts.liabilityCents),
    paygw_w1_cents: Number(opts.totals.paygw_w1),
    paygw_w2_cents: Number(opts.totals.paygw_w2),
    gst_sales_cents: Number(opts.totals.gst_sales),
    gst_purchases_cents: Number(opts.totals.gst_purchases),
    gst_payable_cents: Number(opts.totals.gst_payable),
    gst_credits_cents: Number(opts.totals.gst_credits),
    rates_version: opts.ratesVersion,
    merkle_root: opts.merkleRoot,
    running_balance_hash: opts.runningBalanceHash,
    anomaly_vector: opts.anomalyVector || {},
    thresholds: opts.thresholds || {},
    issued_at: now.toISOString(),
    expires_at: expiresAt.toISOString(),
    nonce
  };

  const payloadC14n = canonicalJson(payload);
  const payloadBytes = Buffer.from(payloadC14n, "utf8");
  const payloadSha256 = sha256Hex(payloadBytes);
  const sk = loadSigningKey();
  const sig = nacl.sign.detached(new Uint8Array(payloadBytes), sk);
  const signature = Buffer.from(sig).toString("base64");

  const status = "active";
  const kid = process.env.RPT_KEY_ID || "local-ed25519";

  await client.query(
    `INSERT INTO rpt_tokens
      (abn,tax_type,period_id,payload,signature,status,created_at,payload_c14n,payload_sha256,nonce,expires_at,kid,rates_version)
     VALUES ($1,$2,$3,$4::jsonb,$5,$6,now(),$7,$8,$9,$10,$11,$12)`,
    [
      opts.abn,
      opts.taxType,
      opts.periodId,
      JSON.stringify(payload),
      signature,
      status,
      payloadC14n,
      payloadSha256,
      nonce,
      expiresAt.toISOString(),
      kid,
      opts.ratesVersion
    ]
  );

  return { payload, payload_c14n: payloadC14n, payload_sha256: payloadSha256, signature };
}

export async function issueRPTWithPool(opts: IssueRPTOptions) {
  const client = await pool.connect();
  try {
    return await issueRPT(client, opts);
  } finally {
    client.release();
  }
}
