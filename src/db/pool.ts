import { Pool } from "pg";

let poolInstance: Pool | null = null;

function createDefaultPool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  return connectionString ? new Pool({ connectionString }) : new Pool();
}

export function getPool(): Pool {
  if (!poolInstance) {
    poolInstance = createDefaultPool();
  }
  return poolInstance;
}

export function setPool(customPool: Pool) {
  poolInstance = customPool;
}

export type { Pool };
