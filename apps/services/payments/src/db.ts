// apps/services/payments/src/db.ts
import pg from "pg";

const { Pool } = pg;

const globalAny = globalThis as Record<string, any>;

// Prefer DATABASE_URL; else compose from PG* vars
const connectionString =
  process.env.DATABASE_URL ??
  `postgres://${process.env.PGUSER || "apgms"}:${encodeURIComponent(process.env.PGPASSWORD || "")}` +
    `@${process.env.PGHOST || "127.0.0.1"}:${process.env.PGPORT || "5432"}/${process.env.PGDATABASE || "apgms"}`;

const existingPool = globalAny.__APGMS_TEST_POOL__ as pg.Pool | undefined;
export const pool = existingPool ?? new Pool({ connectionString });
