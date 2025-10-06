import { Pool } from "pg";

type PoolLike = Pick<Pool, "query" | "connect" | "end">;

let sharedPool: PoolLike | null = null;

const defaultConfig = {
  host: process.env.PGHOST ?? "127.0.0.1",
  user: process.env.PGUSER ?? "apgms",
  password: process.env.PGPASSWORD ?? "apgms_pw",
  database: process.env.PGDATABASE ?? "apgms",
  port: Number(process.env.PGPORT ?? 5432),
};

export function getPool(): PoolLike {
  if (!sharedPool) {
    sharedPool = new Pool(defaultConfig);
  }
  return sharedPool;
}

export function setPool(pool: PoolLike | null): void {
  sharedPool = pool;
}

export type { PoolLike };
