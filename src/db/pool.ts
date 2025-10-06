import { Pool, PoolConfig } from "pg";

const connectionOptions: PoolConfig = {
  connectionString: process.env.DATABASE_URL,
  host: process.env.PGHOST,
  port: process.env.PGPORT ? Number(process.env.PGPORT) : undefined,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE,
};

const filteredEntries = Object.entries(connectionOptions).filter(([, value]) =>
  value !== undefined && value !== ""
);

export const pool = new Pool(Object.fromEntries(filteredEntries) as PoolConfig);

export type DbClient = typeof pool;
