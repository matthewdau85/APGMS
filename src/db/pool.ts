import { Pool, PoolConfig } from "pg";

let singleton: Pool | null = null;

export function getPool(): Pool {
  if (!singleton) {
    const config: PoolConfig = {};
    if (process.env.DATABASE_URL) {
      config.connectionString = process.env.DATABASE_URL;
    } else {
      config.host = process.env.PGHOST;
      if (process.env.PGPORT) config.port = Number(process.env.PGPORT);
      config.user = process.env.PGUSER;
      config.password = process.env.PGPASSWORD;
      config.database = process.env.PGDATABASE;
    }
    if (process.env.PGSSL?.toLowerCase() === "true") {
      config.ssl = { rejectUnauthorized: false };
    }
    config.max = Number(process.env.PGPOOL_MAX ?? 10);

    singleton = new Pool(config);
    singleton.on("error", (err) => {
      console.error("[db] unexpected error on idle client", err);
    });
  }
  return singleton;
}

export const pool = getPool();
