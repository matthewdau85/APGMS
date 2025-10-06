import dotenv from "dotenv";
import { Pool, PoolConfig } from "pg";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

dotenv.config();

function buildPool(): Pool {
  const {
    DATABASE_URL,
    PGHOST = "127.0.0.1",
    PGUSER,
    PGPASSWORD,
    PGDATABASE,
    PGPORT,
    PGSSLMODE,
  } = process.env;

  const config: PoolConfig = {};
  if (DATABASE_URL) {
    config.connectionString = DATABASE_URL;
  } else {
    config.host = PGHOST;
    if (PGUSER) config.user = PGUSER;
    if (PGPASSWORD) config.password = PGPASSWORD;
    if (PGDATABASE) config.database = PGDATABASE;
    if (PGPORT) config.port = Number(PGPORT);
  }

  if (PGSSLMODE && PGSSLMODE !== "disable") {
    config.ssl = { rejectUnauthorized: PGSSLMODE === "verify-full" };
  }

  return new Pool(config);
}

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(moduleDir, "../../migrations");

const globalState = globalThis as unknown as {
  __APGMS_POOL__?: Pool;
  __APGMS_INIT__?: Promise<void> | null;
};

if (!globalState.__APGMS_POOL__) {
  globalState.__APGMS_POOL__ = buildPool();
}

export const pool: Pool = globalState.__APGMS_POOL__;

let initPromise: Promise<void> | null = globalState.__APGMS_INIT__ ?? null;

async function runMigrations(): Promise<void> {
  const files = (await fs.promises.readdir(migrationsDir))
    .filter((name) => name.endsWith(".sql"))
    .sort();

  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS migration_checksums (
        filename TEXT PRIMARY KEY,
        checksum TEXT NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    await client.query("BEGIN");

    for (const file of files) {
      const filePath = path.join(migrationsDir, file);
      const sql = await fs.promises.readFile(filePath, "utf8");
      const checksum = crypto.createHash("sha256").update(sql).digest("hex");

      const existing = await client.query<{ checksum: string }>(
        "SELECT checksum FROM migration_checksums WHERE filename = $1 FOR UPDATE",
        [file]
      );

      if (existing.rowCount) {
        const stored = existing.rows[0].checksum;
        if (stored !== checksum) {
          throw new Error(
            `Migration checksum mismatch for ${file}. Expected ${stored} but file has ${checksum}. Undo local edits or create a new migration.`
          );
        }
        continue;
      }

      if (sql.trim()) {
        await client.query(sql);
      }

      await client.query(
        "INSERT INTO migration_checksums(filename, checksum) VALUES ($1, $2)",
        [file, checksum]
      );
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function initDb(): Promise<void> {
  if (initPromise) {
    return initPromise;
  }

  initPromise = (async () => {
    try {
      await pool.query("SELECT 1");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown database error";
      throw new Error(`Database health check failed: ${message}`);
    }

    await runMigrations();
  })();

  globalState.__APGMS_INIT__ = initPromise;
  return initPromise;
}
