import 'dotenv/config';
import { access, appendFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { Pool } from 'pg';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const migrationsDir = path.resolve(__dirname, '..', 'migrations');
const logFile = path.join(migrationsDir, 'migrate.log');

async function ensureMigrationsTable(pool: Pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id SERIAL PRIMARY KEY,
      filename TEXT NOT NULL UNIQUE,
      checksum TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function getMigrations(): Promise<string[]> {
  const entries = await readdir(migrationsDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
    .map((entry) => entry.name)
    .sort();
}

function checksum(content: string) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

async function logLine(line: string) {
  await appendFile(logFile, `${line}\n`);
}

async function applyMigration(pool: Pool, filename: string, content: string, hash: string) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(content);
    await client.query(
      'INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2)',
      [filename, hash]
    );
    await client.query('COMMIT');
    await logLine(`${new Date().toISOString()} APPLIED ${filename} ${hash}`);
    console.log(`Applied ${filename} (${hash})`);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function verifyMigration(pool: Pool, filename: string, hash: string) {
  const existing = await pool.query<{ checksum: string }>(
    'SELECT checksum FROM schema_migrations WHERE filename = $1',
    [filename]
  );
  if (!existing.rowCount) {
    return false;
  }
  const stored = existing.rows[0].checksum;
  if (stored !== hash) {
    throw new Error(`Checksum mismatch for ${filename}. Expected ${stored}, got ${hash}`);
  }
  await logLine(`${new Date().toISOString()} SKIPPED ${filename} ${hash}`);
  console.log(`Skipping ${filename}; already applied with checksum ${hash}`);
  return true;
}

async function main() {
  await mkdir(path.dirname(logFile), { recursive: true });
  try {
    await access(logFile);
  } catch {
    await writeFile(logFile, '', 'utf8');
  }

  const connectionString = process.env.DATABASE_URL;
  const pool = new Pool(connectionString ? { connectionString } : undefined);

  try {
    await ensureMigrationsTable(pool);
    const files = await getMigrations();
    if (!files.length) {
      console.log('No migrations found.');
      return;
    }

    for (const filename of files) {
      const fullPath = path.join(migrationsDir, filename);
      const sql = await readFile(fullPath, 'utf8');
      const hash = checksum(sql);
      const alreadyApplied = await verifyMigration(pool, filename, hash);
      if (alreadyApplied) continue;
      await applyMigration(pool, filename, sql, hash);
    }

    console.log('Migrations complete.');
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error('Migration failed:', error);
  process.exitCode = 1;
});
