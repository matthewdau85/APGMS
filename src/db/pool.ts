import 'dotenv/config';
import { Pool, PoolConfig } from 'pg';

const poolConfig: PoolConfig | undefined = process.env.DATABASE_URL
  ? { connectionString: process.env.DATABASE_URL }
  : undefined;

export const pool = new Pool(poolConfig);

export async function withClient<T>(fn: (client: import('pg').PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}
