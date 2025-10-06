import { Pool, PoolConfig } from "pg";

const DEFAULT_MAX = Number(process.env.PG_POOL_MAX ?? 10);
const DEFAULT_IDLE = Number(process.env.PG_IDLE_TIMEOUT_MS ?? 10_000);
const DEFAULT_CONN_TIMEOUT = Number(process.env.PG_CONN_TIMEOUT_MS ?? 2_000);

const poolConfig: PoolConfig = {
  max: DEFAULT_MAX,
  idleTimeoutMillis: DEFAULT_IDLE,
  connectionTimeoutMillis: DEFAULT_CONN_TIMEOUT,
};

const pool = new Pool(poolConfig);

pool.on("error", (err) => {
  console.error("[pg] unexpected pool error", err);
});

export { pool, poolConfig };

export function getPoolStats() {
  return {
    total: pool.totalCount,
    idle: pool.idleCount,
    waiting: pool.waitingCount,
  };
}

export function getPoolMax() {
  return poolConfig.max ?? DEFAULT_MAX;
}
