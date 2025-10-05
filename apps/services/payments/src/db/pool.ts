import pg, { PoolConfig } from "pg";

const { Pool } = pg;

declare global {
  // eslint-disable-next-line no-var
  var __apgmsPaymentsPool: pg.Pool | undefined;
}

const globalWithPool = globalThis as typeof globalThis & { __apgmsPaymentsPool?: pg.Pool };

const createConfig = (): PoolConfig => {
  if (process.env.DATABASE_URL) {
    return { connectionString: process.env.DATABASE_URL };
  }
  const user = process.env.PGUSER || "apgms";
  const password = encodeURIComponent(process.env.PGPASSWORD || "");
  const host = process.env.PGHOST || "127.0.0.1";
  const port = process.env.PGPORT || "5432";
  const database = process.env.PGDATABASE || "apgms";
  return { connectionString: `postgres://${user}:${password}@${host}:${port}/${database}` };
};

const attachDiagnostics = (pool: pg.Pool, label: string) => {
  const configuredMax = Number(process.env.PGPOOL_MAX_CONNECTIONS || "");
  const maxConnections =
    Number.isFinite(configuredMax) && configuredMax > 0
      ? configuredMax
      : (pool.options as PoolConfig).max ?? 10;
  (pool as unknown as { __apgmsMax?: number }).__apgmsMax = maxConnections;

  const diagnosticsEnabled =
    process.env.DB_POOL_DIAGNOSTICS === "true" || process.env.NODE_ENV === "test";
  if (!diagnosticsEnabled) return;

  const logState = (event: string) => {
    const total = pool.totalCount;
    const idle = pool.idleCount;
    const waiting = pool.waitingCount;
    const active = total - idle;
    const message =
      `[${label}:${event}] total=${total} active=${active} idle=${idle} waiting=${waiting} max=${maxConnections}`;
    if (active > maxConnections) {
      console.warn(`${message} ⚠️ active connections exceed max`);
    } else {
      console.debug(message);
    }
  };

  pool.on("connect", () => logState("connect"));
  pool.on("acquire", () => logState("acquire"));
  pool.on("remove", () => logState("remove"));
  logState("bootstrap");

  const intervalMs = Number(process.env.DB_POOL_DIAGNOSTIC_INTERVAL_MS ?? "15000");
  if (Number.isFinite(intervalMs) && intervalMs > 0) {
    const timer = setInterval(() => logState("interval"), intervalMs);
    if (typeof timer.unref === "function") timer.unref();
  }
};

if (!globalWithPool.__apgmsPaymentsPool) {
  const pool = new Pool(createConfig());
  attachDiagnostics(pool, "payments-db");
  globalWithPool.__apgmsPaymentsPool = pool;
}

const poolInstance = globalWithPool.__apgmsPaymentsPool as pg.Pool;

export const pool = poolInstance;
export const getPool = () => poolInstance;
export const getPoolMetrics = () => {
  const max = (poolInstance as unknown as { __apgmsMax?: number }).__apgmsMax ??
    (poolInstance.options as PoolConfig).max ?? 10;
  return {
    total: poolInstance.totalCount,
    idle: poolInstance.idleCount,
    waiting: poolInstance.waitingCount,
    active: poolInstance.totalCount - poolInstance.idleCount,
    max,
  };
};

