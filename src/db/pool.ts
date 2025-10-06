import pg from "pg";

const { Pool } = pg;

type PoolFactory = () => pg.Pool;

let pool: pg.Pool | null = null;
let customFactory: PoolFactory | null = null;

function createDefaultPool(): pg.Pool {
  const connectionString =
    process.env.DATABASE_URL ??
    `postgres://${process.env.PGUSER || "apgms"}:${encodeURIComponent(process.env.PGPASSWORD || "")}` +
      `@${process.env.PGHOST || "127.0.0.1"}:${process.env.PGPORT || "5432"}/${process.env.PGDATABASE || "apgms"}`;
  return new Pool({ connectionString });
}

function buildPool(): pg.Pool {
  if (customFactory) {
    return customFactory();
  }
  return createDefaultPool();
}

export function getPool(): pg.Pool {
  if (!pool) {
    pool = buildPool();
  }
  return pool;
}

export function setPoolFactory(factory: PoolFactory | null) {
  customFactory = factory;
  if (pool) {
    void pool.end().catch(() => undefined);
    pool = null;
  }
}

export type { Pool } from "pg";
