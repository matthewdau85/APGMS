import { Pool } from "pg";

let pool: Pool | null = null;

function buildConnectionString(): string | undefined {
  if (process.env.DATABASE_URL) {
    return process.env.DATABASE_URL;
  }
  const user = process.env.PGUSER || "apgms";
  const password = encodeURIComponent(process.env.PGPASSWORD || "");
  const host = process.env.PGHOST || "127.0.0.1";
  const port = process.env.PGPORT || "5432";
  const database = process.env.PGDATABASE || "apgms";
  return `postgres://${user}:${password}@${host}:${port}/${database}`;
}

export function getPool(): Pool {
  if (!pool) {
    const connectionString = buildConnectionString();
    pool = new Pool(connectionString ? { connectionString } : undefined);
  }
  return pool;
}

export function setPoolForTests(custom: any) {
  if (pool && typeof (pool as any).end === "function") {
    (pool as any).end().catch(() => undefined);
  }
  pool = custom;
}
