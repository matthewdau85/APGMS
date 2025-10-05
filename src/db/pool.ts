import { Pool } from "pg";

export interface QueryResult<T = any> {
  rows: T[];
  rowCount: number;
}

export interface PoolLike {
  query: (text: string, params?: any[]) => Promise<QueryResult>;
  end?: () => Promise<void> | void;
}

let activePool: PoolLike | null = null;

export function getPool(): PoolLike {
  if (!activePool) {
    activePool = new Pool();
  }
  return activePool;
}

export function setPool(pool: PoolLike | null) {
  activePool = pool;
}

export async function shutdownPool() {
  if (activePool && typeof activePool.end === "function") {
    await activePool.end();
  }
  activePool = null;
}
