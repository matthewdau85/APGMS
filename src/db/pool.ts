import { Pool, PoolConfig } from "pg";

let pool: Pool | undefined;

export function getPool(): Pool {
  if (!pool) {
    const {
      DATABASE_URL,
      PGHOST,
      PGUSER,
      PGPASSWORD,
      PGDATABASE,
      PGPORT,
    } = process.env;

    const config: PoolConfig = {};
    if (DATABASE_URL) {
      config.connectionString = DATABASE_URL;
    } else {
      if (PGHOST) config.host = PGHOST;
      if (PGUSER) config.user = PGUSER;
      if (PGPASSWORD) config.password = PGPASSWORD;
      if (PGDATABASE) config.database = PGDATABASE;
      if (PGPORT) config.port = Number(PGPORT);
    }

    pool = new Pool(config);
  }

  return pool;
}
