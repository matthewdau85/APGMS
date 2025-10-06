import { Pool, PoolClient, QueryResult } from "pg";

export type Queryable = Pool | PoolClient;

const {
  PGHOST,
  PGUSER,
  PGPASSWORD,
  PGDATABASE,
  PGPORT,
  DATABASE_URL,
} = process.env;

const connectionOptions = DATABASE_URL
  ? { connectionString: DATABASE_URL }
  : {
      host: PGHOST,
      user: PGUSER,
      password: PGPASSWORD,
      database: PGDATABASE,
      port: PGPORT ? Number(PGPORT) : undefined,
    };

export const pool = new Pool(connectionOptions);

pool.on("error", (err) => {
  console.error("[db] unexpected error", err);
});

export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function query<T = any>(
  text: string,
  params: any[] = [],
  client: Queryable = pool,
): Promise<QueryResult<T>> {
  return client.query<T>(text, params);
}

