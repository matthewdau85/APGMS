import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { Client } from "pg";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const migrationsDir = path.join(repoRoot, "migrations");

const defaultUrl =
  process.env.DATABASE_URL ??
  `postgres://${process.env.PGUSER || "apgms"}:${encodeURIComponent(process.env.PGPASSWORD || "")}` +
    `@${process.env.PGHOST || "127.0.0.1"}:${process.env.PGPORT || "5432"}/${process.env.PGDATABASE || "apgms"}`;

async function ensureMigrationsTable(client: Client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      checksum TEXT NOT NULL,
      executed_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

async function applyMigration(client: Client, filename: string, sql: string, checksum: string) {
  await client.query("BEGIN");
  try {
    await client.query(sql);
    await client.query(
      "INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2)",
      [filename, checksum]
    );
    await client.query("COMMIT");
    console.log(`Applied migration ${filename}`);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
}

async function main() {
  const files = (await readdir(migrationsDir))
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const client = new Client({ connectionString: defaultUrl });
  await client.connect();

  try {
    await ensureMigrationsTable(client);

    for (const file of files) {
      const sql = await readFile(path.join(migrationsDir, file), "utf8");
      const checksum = createHash("sha256").update(sql).digest("hex");
      const { rows } = await client.query(
        "SELECT checksum FROM schema_migrations WHERE filename=$1",
        [file]
      );

      if (rows.length === 0) {
        await applyMigration(client, file, sql, checksum);
      } else if (rows[0].checksum !== checksum) {
        throw new Error(
          `Checksum mismatch for migration ${file}. Expected ${rows[0].checksum} but found ${checksum}.`
        );
      } else {
        console.log(`Skipping ${file} (already applied)`);
      }
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("Migration failed", err);
  process.exit(1);
});
