import { Client, ClientConfig } from "pg";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { promises as fs } from "fs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
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
    throw new Error("DATABASE_URL or PG* variables are required for smoke tests");
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
  const targetAbn = process.env.SEED_ABN || "53004085616";
  const targetTax = process.env.SEED_TAX_TYPE || "GST";
  const targetPeriod = process.env.SEED_PERIOD_ID || "2025Q1";

  const client = new Client(buildConfig());
  await client.connect();

  try {
    const columnCheck = await client.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name='rpt_tokens' AND column_name='payload_sha256'`
    );
    if (columnCheck.rowCount === 0) {
      throw new Error("rpt_tokens.payload_sha256 missing; migrations may be out of date");
    }

    const res = await client.query(
      `SELECT id, payload->>'abn' AS abn, payload_sha256 FROM rpt_tokens WHERE abn=$1 AND tax_type=$2 AND period_id=$3`,
      [targetAbn, targetTax, targetPeriod]
    );
    if (res.rowCount === 0) {
      throw new Error(`No RPT token found for ${targetAbn}/${targetTax}/${targetPeriod}`);
    }
    const token = res.rows[0];
    if (!token.payload_sha256) {
      throw new Error("Seeded RPT token is missing payload_sha256 hash");
    }
    console.log(`Smoke check passed for token ${token.id} (${token.abn}).`);

    const mig = await client.query(`SELECT COUNT(*)::int AS count FROM apgms_migrations`);
    const count = mig.rows[0]?.count ?? 0;
    if (count < 1) {
      throw new Error("No migration records found; migration tracking table empty");
    }
    console.log(`Verified ${count} recorded migrations.`);
  } finally {
    await client.end();
  }
}

main().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
