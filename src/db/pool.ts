import { Pool } from "pg";

const connectionString =
  process.env.DATABASE_URL ??
  `postgres://${process.env.PGUSER || "apgms"}:${encodeURIComponent(process.env.PGPASSWORD || "apgms_pw")}` +
  `@${process.env.PGHOST || "127.0.0.1"}:${process.env.PGPORT || "5432"}/${process.env.PGDATABASE || "apgms"}`;

export const pool = new Pool({ connectionString });

export type DbPool = typeof pool;
