import pg from "pg";

const { Pool } = pg;

const connectionString =
  process.env.DATABASE_URL ??
  `postgres://${process.env.PGUSER || "apgms"}:${encodeURIComponent(process.env.PGPASSWORD || "")}` +
    `@${process.env.PGHOST || "127.0.0.1"}:${process.env.PGPORT || "5432"}/${
      process.env.PGDATABASE || "apgms"
    }`;

const GLOBAL_POOL_KEY = "__APGMS_PAYMENTS_POOL__";
const globalState = globalThis as Record<string, unknown>;

const poolInstance =
  (globalState[GLOBAL_POOL_KEY] as pg.Pool | undefined) ??
  (globalState[GLOBAL_POOL_KEY] = new Pool({ connectionString }));

export const pool = poolInstance as pg.Pool;
