import { Pool } from "pg";

const {
  DATABASE_URL,
  PGHOST = "127.0.0.1",
  PGUSER = "apgms",
  PGPASSWORD = "apgms_pw",
  PGDATABASE = "apgms",
  PGPORT = "5432",
  PGSSLMODE
} = process.env;

const pool = new Pool(
  DATABASE_URL
    ? {
        connectionString: DATABASE_URL,
        ssl: PGSSLMODE === "require" ? { rejectUnauthorized: false } : undefined
      }
    : {
        host: PGHOST,
        user: PGUSER,
        password: PGPASSWORD,
        database: PGDATABASE,
        port: Number(PGPORT)
      }
);

export default pool;
export { pool };
