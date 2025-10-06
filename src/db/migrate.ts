import { promises as fs } from "fs";
import { createHash } from "crypto";
import { resolve } from "path";
import type { PoolClient } from "pg";
import { pool } from "./pool";

interface MigrationMeta {
  filename: string;
  sql: string;
  hash: string;
}

const MIGRATIONS_DIR = resolve(process.cwd(), "migrations");

async function readMigrations(): Promise<MigrationMeta[]> {
  const files = await fs.readdir(MIGRATIONS_DIR);
  const sorted = files.filter(f => f.endsWith(".sql")).sort();
  const migrations: MigrationMeta[] = [];
  for (const filename of sorted) {
    const sql = await fs.readFile(resolve(MIGRATIONS_DIR, filename), "utf8");
    const hash = createHash("sha256").update(sql).digest("hex");
    migrations.push({ filename, sql, hash });
  }
  return migrations;
}

async function ensureMigrationsTable(client: PoolClient) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      hash TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

export async function runMigrations() {
  const migrations = await readMigrations();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await ensureMigrationsTable(client);
    for (const migration of migrations) {
      const existing = await client.query(
        `SELECT hash FROM schema_migrations WHERE filename=$1`,
        [migration.filename],
      );
      if (existing.rowCount) {
        if (existing.rows[0].hash !== migration.hash) {
          throw new Error(`Migration checksum mismatch for ${migration.filename}`);
        }
        continue;
      }
      await client.query(migration.sql);
      await client.query(
        `INSERT INTO schema_migrations (filename, hash) VALUES ($1,$2)`,
        [migration.filename, migration.hash],
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
