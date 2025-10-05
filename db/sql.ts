import pg, { PoolClient, QueryResultRow } from "pg";

const { Pool } = pg;

const connectionString =
  process.env.DATABASE_URL ??
  (process.env.PGHOST || process.env.PGUSER || process.env.PGDATABASE
    ? `postgres://${process.env.PGUSER || "apgms"}:${encodeURIComponent(process.env.PGPASSWORD || "")}` +
      `@${process.env.PGHOST || "127.0.0.1"}:${process.env.PGPORT || "5432"}/${process.env.PGDATABASE || "apgms"}`
    : undefined);

export const pool = new Pool(connectionString ? { connectionString } : undefined);

export function q<T extends QueryResultRow = QueryResultRow>(text: string, values: any[] = []) {
  return pool.query<T>(text, values);
}

export async function tx<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackErr) {
      // eslint-disable-next-line no-console
      console.error("rollback failed", rollbackErr);
    }
    throw err;
  } finally {
    client.release();
  }
}
