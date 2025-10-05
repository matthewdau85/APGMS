import { Pool } from "pg";

const {
  DATABASE_URL,
  PGHOST,
  PGPORT,
  PGDATABASE,
  PGUSER,
  PGPASSWORD,
} = process.env;

const poolConfig = DATABASE_URL
  ? { connectionString: DATABASE_URL }
  : {
      host: PGHOST || undefined,
      port: PGPORT ? Number(PGPORT) : undefined,
      database: PGDATABASE || undefined,
      user: PGUSER || undefined,
      password: PGPASSWORD || undefined,
    };

export const pool = new Pool(poolConfig);
