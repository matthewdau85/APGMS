import { Client, ClientConfig } from "pg";
import crypto from "crypto";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { promises as fs } from "fs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const DEFAULT_ABN = "53004085616";
const DEFAULT_TAX = "GST";
const DEFAULT_PERIOD = "2025Q1";

async function fileExists(p: string) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function loadEnv() {
  const envFiles = [".env", ".env.local"];
  for (const file of envFiles) {
    const full = path.join(repoRoot, file);
    if (await fileExists(full)) {
      dotenv.config({ path: full, override: false });
    }
  }
}

function buildConfig(): ClientConfig {
  const url = process.env.DATABASE_URL;
  if (url) return { connectionString: url };

  const { PGHOST, PGPORT, PGDATABASE, PGUSER, PGPASSWORD } = process.env;
  if (!PGHOST || !PGDATABASE || !PGUSER) {
    throw new Error("DATABASE_URL or PG* variables are required to seed data");
  }

  return {
    host: PGHOST,
    port: PGPORT ? parseInt(PGPORT, 10) : 5432,
    database: PGDATABASE,
    user: PGUSER,
    password: PGPASSWORD
  };
}

async function main() {
  await loadEnv();
  const config = buildConfig();
  const client = new Client(config);
  await client.connect();

  const abn = process.env.SEED_ABN || DEFAULT_ABN;
  const taxType = process.env.SEED_TAX_TYPE || DEFAULT_TAX;
  const periodId = process.env.SEED_PERIOD_ID || DEFAULT_PERIOD;

  const payload = {
    abn,
    taxType,
    periodId,
    issuedAt: new Date().toISOString(),
    nonce: crypto.randomUUID(),
    kid: "seed-local-kms"
  };

  const payloadJson = JSON.stringify(payload);
  const payloadSha = crypto.createHash("sha256").update(payloadJson).digest("hex");
  const c14n = payloadJson; // already canonical because key order fixed in literal
  const signature = crypto.createHash("sha512").update(payloadJson).digest("hex");

  try {
    await client.query("BEGIN");
    await client.query(
      "DELETE FROM rpt_tokens WHERE abn=$1 AND tax_type=$2 AND period_id=$3",
      [abn, taxType, periodId]
    );
    const result = await client.query(
      `
      INSERT INTO rpt_tokens
        (abn, tax_type, period_id, payload, signature, status, payload_c14n, payload_sha256, created_at)
      VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,$8, now())
      RETURNING id
      `,
      [abn, taxType, periodId, payloadJson, signature, "SEEDED", c14n, payloadSha]
    );
    await client.query("COMMIT");
    console.log(`Seeded rpt token ${result.rows[0].id} for ${periodId}`);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    await client.end();
  }
}

main().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
