import { Pool } from "pg";

let pool: Pool | null = null;

function buildConnectionString(): string | undefined {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;

  const user = process.env.PGUSER ?? process.env.POSTGRES_USER ?? "apgms";
  const password = process.env.PGPASSWORD ?? process.env.POSTGRES_PASSWORD ?? "";
  const host = process.env.PGHOST ?? process.env.POSTGRES_HOST ?? "127.0.0.1";
  const port = process.env.PGPORT ?? process.env.POSTGRES_PORT ?? "5432";
  const db = process.env.PGDATABASE ?? process.env.POSTGRES_DB ?? "apgms";

  const encodedPassword = encodeURIComponent(password);
  return `postgres://${user}:${encodedPassword}@${host}:${port}/${db}`;
}

export function getPool(): Pool {
  if (!pool) {
    const connectionString = buildConnectionString();
    pool = connectionString ? new Pool({ connectionString }) : new Pool();
  }
  return pool;
}
