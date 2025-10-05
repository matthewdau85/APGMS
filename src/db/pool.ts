import { Pool, PoolConfig } from "pg";

declare global {
  // eslint-disable-next-line no-var
  var __apgmsPool: Pool | undefined;
}

const globalWithPool = globalThis as typeof globalThis & { __apgmsPool?: Pool };

const createPool = () => {
  const config: PoolConfig = {};
  if (process.env.DATABASE_URL) {
    config.connectionString = process.env.DATABASE_URL;
  }
  const pool = new Pool(config);

  const configuredMax = Number(process.env.PGPOOL_MAX_CONNECTIONS || "");
  const maxConnections =
    Number.isFinite(configuredMax) && configuredMax > 0
      ? configuredMax
      : (pool.options as PoolConfig).max ?? 10;
  (pool as unknown as { __apgmsMax?: number }).__apgmsMax = maxConnections;

  const diagnosticsEnabled =
    process.env.DB_POOL_DIAGNOSTICS === "true" || process.env.NODE_ENV === "test";
  if (diagnosticsEnabled) {
    const logState = (event: string) => {
      const total = pool.totalCount;
      const idle = pool.idleCount;
      const waiting = pool.waitingCount;
      const active = total - idle;
      const message =
        `[db-pool:${event}] total=${total} active=${active} idle=${idle} waiting=${waiting}` +
        ` max=${maxConnections}`;
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
  }

  return pool;
};

if (!globalWithPool.__apgmsPool) {
  globalWithPool.__apgmsPool = createPool();
}

const poolInstance = globalWithPool.__apgmsPool as Pool;

export const pool: Pool = poolInstance;
export const getPool = (): Pool => poolInstance;
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

