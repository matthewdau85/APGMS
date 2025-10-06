// scripts/seed_rpt.ts
import { Client } from "pg";
import crypto from "crypto";

function canonicalize(obj: any): string {
  if (obj === null || typeof obj !== "object") return JSON.stringify(obj);
  if (Array.isArray(obj)) return "[" + obj.map(x => canonicalize(x)).join(",") + "]";
  const keys = Object.keys(obj).sort();
  const body = keys.map(k => JSON.stringify(k) + ":" + canonicalize(obj[k])).join(",");
  return "{" + body + "}";
}

function hexToBuf(hex: string) { return Buffer.from(hex, "hex"); }

(async () => {
  const url = process.env.DATABASE_URL!;
  const privPem = Buffer.from(process.env.ED25519_PRIVATE_BASE64!, "base64").toString("utf8");
  const key = crypto.createPrivateKey({ key: privPem });

  const abn = "53004085616";
  const taxType = "PAYG";
  const periodId = "2024Q4";
  const kid = "dev-ed25519-kms-001"; // mirrors KMS key id in prod
  const ratesVersion = process.env.RPT_RATES_VERSION || "2024-10-ATO-v1";

  const payload = {
    abn, taxType, periodId,
    ceilingCents: 200000,
    issuedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 24*3600*1000).toISOString(),
    nonce: crypto.randomBytes(16).toString("hex"),
    kid,
    ratesVersion
  };

  const c14n = canonicalize(payload);
  const sha = crypto.createHash("sha256").update(c14n).digest(); // Buffer

  // Ed25519 sign the canonical JSON
  const sig = crypto.sign(null, Buffer.from(c14n), key); // Ed25519

  const client = new Client({ connectionString: url });
  await client.connect();

  const res = await client.query(
    `
    INSERT INTO rpt_tokens
      (abn, tax_type, period_id, key_id, payload_json, rates_version, payload_c14n, payload_sha256, sig_ed25519, nonce, expires_at, status)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'active')
    ON CONFLICT (abn, tax_type, period_id) WHERE status IN ('pending','active')
    DO UPDATE SET
      key_id = EXCLUDED.key_id,
      payload_json = EXCLUDED.payload_json,
      rates_version = EXCLUDED.rates_version,
      payload_c14n = EXCLUDED.payload_c14n,
      payload_sha256 = EXCLUDED.payload_sha256,
      sig_ed25519 = EXCLUDED.sig_ed25519,
      nonce = EXCLUDED.nonce,
      expires_at = EXCLUDED.expires_at,
      status = 'active'
    RETURNING id
    `,
    [
      abn, taxType, periodId,
      kid,
      payload,
      ratesVersion,
      c14n,
      sha,          // BYTEA
      sig,          // BYTEA
      payload.nonce,
      payload.expiresAt
    ]
  );
  console.log("Seeded/updated RPT id:", res.rows[0].id);
  await client.end();
})();
