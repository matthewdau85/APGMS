import pg from "pg";
import { once } from "events";

const { Pool } = pg;

type PoolConfig = pg.PoolConfig & { connectionString?: string };

function buildConfig(): PoolConfig {
  if (process.env.DATABASE_URL) {
    return { connectionString: process.env.DATABASE_URL };
  }
  const {
    PGHOST = "127.0.0.1",
    PGUSER = "apgms",
    PGPASSWORD = "",
    PGDATABASE = "apgms",
    PGPORT = "5432",
    PGSSLMODE,
  } = process.env;

  const ssl = PGSSLMODE?.toLowerCase() === "require" ? { rejectUnauthorized: false } : undefined;
  return {
    host: PGHOST,
    user: PGUSER,
    password: PGPASSWORD,
    database: PGDATABASE,
    port: Number(PGPORT),
    ssl,
  };
}

let singleton: pg.Pool | undefined;

export function getPool(): pg.Pool {
  if (!singleton) {
    singleton = new Pool(buildConfig());
    singleton.on("end", () => {
      singleton = undefined;
    });
    // Ensure pool closes cleanly on SIGTERM/SIGINT in scripts.
    const shutdown = async () => {
      if (!singleton) return;
      const poolRef = singleton;
      singleton = undefined;
      await poolRef.end().catch(() => undefined);
    };
    process.once("SIGTERM", shutdown);
    process.once("SIGINT", shutdown);
    // Defensive: drain pool if Node is about to exit naturally.
    once(process, "beforeExit").then(shutdown).catch(() => undefined);
  }
  return singleton;
}

export const pool = getPool();

export default pool;
