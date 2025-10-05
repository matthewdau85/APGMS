import { Pool, PoolConfig } from "pg";

let sharedPool: Pool | null = null;

export function getPool(): Pool {
  if (!sharedPool) {
    sharedPool = new Pool();
  }
  return sharedPool;
}

export function initPool(config?: PoolConfig): Pool {
  const pool = new Pool(config);
  setPool(pool);
  return pool;
}

export function setPool(pool: Pool) {
  sharedPool = pool;
}
