import { Pool } from "pg";

let sharedPool: Pool | null = null;

export function getPool(): Pool {
  if (!sharedPool) {
    sharedPool = new Pool();
  }
  return sharedPool;
}

export function setPoolForTests(pool: Pool) {
  sharedPool = pool;
}
