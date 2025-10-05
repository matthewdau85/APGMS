import { Pool } from "pg";

let currentPool: Pool | null = null;

export function getPool(): Pool {
  if (!currentPool) {
    currentPool = new Pool();
  }
  return currentPool;
}

export function setPool(pool: Pool | null) {
  currentPool = pool;
}
