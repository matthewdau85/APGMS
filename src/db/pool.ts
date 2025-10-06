import { Pool } from "pg";

let singleton: Pool | null = null;

function buildPool(): Pool {
  const {
    PGHOST = "127.0.0.1",
    PGUSER = "apgms",
    PGPASSWORD = "apgms_pw",
    PGDATABASE = "apgms",
    PGPORT = "5432",
    DATABASE_URL,
  } = process.env;

  if (DATABASE_URL) {
    return new Pool({ connectionString: DATABASE_URL });
  }

  return new Pool({
    host: PGHOST,
    user: PGUSER,
    password: PGPASSWORD,
    database: PGDATABASE,
    port: Number(PGPORT),
  });
}

export function getPool(): Pool {
  if (!singleton) {
    singleton = buildPool();
  }
  return singleton;
}

export const pool = getPool();
