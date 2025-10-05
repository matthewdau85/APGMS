import { Pool } from "pg";

let pool: Pool | null = null;

export const getPool = () => {
  if (!pool) {
    pool = new Pool();
  }
  return pool;
};
