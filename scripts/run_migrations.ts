import { Client } from "pg";
import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const MIGRATIONS_DIR = path.resolve(process.cwd(), "migrations");

async function listMigrationFiles(): Promise<string[]> {
  const entries = await fs.readdir(MIGRATIONS_DIR);
  return entries
    .filter((file) => file.endsWith(".sql"))
    .sort();
}

async function readMigration(file: string) {
  const fullPath = path.join(MIGRATIONS_DIR, file);
  const sql = await fs.readFile(fullPath, "utf8");
  const checksum = crypto.createHash("sha256").update(sql).digest("hex");
  return { sql, checksum };
}

async function ensureTable(client: Client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      checksum TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL not set");
  }

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    await ensureTable(client);
    const files = await listMigrationFiles();
    const appliedRes = await client.query(`SELECT filename, checksum FROM schema_migrations`);
    const applied = new Map<string, string>(appliedRes.rows.map((row) => [row.filename, row.checksum]));

    for (const file of files) {
      const { sql, checksum } = await readMigration(file);
      const existing = applied.get(file);
      if (existing) {
        if (existing !== checksum) {
          throw new Error(`Migration drift detected for ${file}`);
        }
        continue;
      }
      console.log(`[migrate] applying ${file}`);
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query(`INSERT INTO schema_migrations(filename, checksum) VALUES ($1,$2)`, [file, checksum]);
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      }
    }

    for (const [filename] of applied) {
      if (!files.includes(filename)) {
        throw new Error(`Migration ${filename} recorded in database but missing from repository`);
      }
    }
    console.log("[migrate] complete");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("[migrate] failed", err);
  process.exitCode = 1;
});
