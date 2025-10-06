import { Client, ClientConfig } from "pg";
import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";
import dotenv from "dotenv";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");

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
  if (url) {
    return { connectionString: url };
  }

  const { PGHOST, PGPORT, PGDATABASE, PGUSER, PGPASSWORD } = process.env;
  if (!PGHOST || !PGDATABASE || !PGUSER) {
    throw new Error("DATABASE_URL or PG* environment variables must be set for migrations");
  }

  return {
    host: PGHOST,
    port: PGPORT ? parseInt(PGPORT, 10) : 5432,
    database: PGDATABASE,
    user: PGUSER,
    password: PGPASSWORD
  };
}

async function fileExists(p: string) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function ensureMigrationsTable(client: Client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS apgms_migrations (
      id SERIAL PRIMARY KEY,
      file_name TEXT NOT NULL UNIQUE,
      checksum TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}

async function applyMigration(client: Client, filePath: string) {
  const name = path.basename(filePath);
  const sql = await fs.readFile(filePath, "utf8");
  const checksum = crypto.createHash("sha256").update(sql).digest("hex");

  const existing = await client.query<{
    checksum: string;
  }>("SELECT checksum FROM apgms_migrations WHERE file_name = $1", [name]);

  if (existing.rowCount === 1) {
    const stored = existing.rows[0].checksum;
    if (stored !== checksum) {
      throw new Error(`Checksum drift detected for migration ${name}. Expected ${stored} but file is ${checksum}`);
    }
    console.log(`✔ Migration ${name} already applied.`);
    return;
  }

  console.log(`→ Applying migration ${name}...`);
  try {
    await client.query("BEGIN");
    await client.query(sql);
    await client.query(
      "INSERT INTO apgms_migrations (file_name, checksum) VALUES ($1, $2)",
      [name, checksum]
    );
    await client.query("COMMIT");
    console.log(`✔ Migration ${name} applied.`);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
}

async function main() {
  await loadEnv();
  const migrationsDir = path.join(repoRoot, "migrations");
  if (!(await fileExists(migrationsDir))) {
    throw new Error(`Migrations directory missing: ${migrationsDir}`);
  }

  const files = (await fs.readdir(migrationsDir))
    .filter(f => f.endsWith(".sql"))
    .sort();

  if (files.length === 0) {
    console.log("No migrations to run.");
    return;
  }

  const config = buildConfig();
  const client = new Client(config);
  await client.connect();

  try {
    await ensureMigrationsTable(client);
    for (const file of files) {
      const fp = path.join(migrationsDir, file);
      await applyMigration(client, fp);
    }
  } finally {
    await client.end();
  }
}

main().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
