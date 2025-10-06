import { Pool } from "pg";

let sharedPool: Pool | null = null;

export function getPool(): Pool {
  if (!sharedPool) {
    sharedPool = new Pool();
  }
  return sharedPool;
}

export function setPool(customPool: Pool | null): void {
  sharedPool = customPool;
}

export async function closePool(): Promise<void> {
  if (sharedPool) {
    await sharedPool.end();
    sharedPool = null;
  }
}
