import pg from "pg";

const { Pool } = pg;

let pool: pg.Pool | null = null;

function connectionString(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const user = process.env.PGUSER || "postgres";
  const password = encodeURIComponent(process.env.PGPASSWORD || "");
  const host = process.env.PGHOST || "127.0.0.1";
  const port = process.env.PGPORT || "5432";
  const db = process.env.PGDATABASE || "postgres";
  return `postgres://${user}:${password}@${host}:${port}/${db}`;
}

export function getPool(): pg.Pool {
  if (!pool) {
    pool = new Pool({ connectionString: connectionString() });
  }
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
