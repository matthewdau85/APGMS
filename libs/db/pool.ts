import { Pool, PoolConfig } from "pg";

export interface TrackedPool extends Pool {
  readonly poolName: string;
  readonly maxSize: number;
}

export interface PoolMetrics {
  name: string;
  total: number;
  idle: number;
  waiting: number;
  active: number;
  max: number;
  saturation: number;
  createdAt: number;
}

const registry = new Map<string, TrackedPool>();
const metricsCache = new Map<string, PoolMetrics>();

function resolveConfig(config: PoolConfig | undefined): PoolConfig {
  const maxFromEnv = process.env.PG_POOL_MAX ? Number(process.env.PG_POOL_MAX) : undefined;
  const idleTimeoutMs = process.env.PG_POOL_IDLE_TIMEOUT_MS ? Number(process.env.PG_POOL_IDLE_TIMEOUT_MS) : undefined;
  const connectionTimeoutMs = process.env.PG_POOL_CONNECT_TIMEOUT_MS ? Number(process.env.PG_POOL_CONNECT_TIMEOUT_MS) : undefined;
  const parsed: PoolConfig = { ...config };
  if (Number.isFinite(maxFromEnv as number)) parsed.max = Number(maxFromEnv);
  if (Number.isFinite(idleTimeoutMs as number)) parsed.idleTimeoutMillis = Number(idleTimeoutMs);
  if (Number.isFinite(connectionTimeoutMs as number)) parsed.connectionTimeoutMillis = Number(connectionTimeoutMs);
  return parsed;
}

export function createPgPool(name: string, config?: PoolConfig): TrackedPool {
  const existing = registry.get(name);
  if (existing) return existing;

  const pool = new Pool(resolveConfig(config)) as TrackedPool;
  Object.defineProperty(pool, "poolName", { value: name, enumerable: false });
  Object.defineProperty(pool, "maxSize", { value: pool.options.max ?? 10, enumerable: false });

  metricsCache.set(name, {
    name,
    total: 0,
    idle: 0,
    waiting: 0,
    active: 0,
    max: pool.options.max ?? 10,
    saturation: 0,
    createdAt: Date.now(),
  });

  pool.on("error", (err) => {
    console.error(`[pg:${name}] pooled client error`, err);
  });

  registry.set(name, pool);
  return pool;
}

export function getPoolMetrics(): PoolMetrics[] {
  const snapshots: PoolMetrics[] = [];
  for (const [name, pool] of registry) {
    const max = pool.options.max ?? metricsCache.get(name)?.max ?? 10;
    const total = pool.totalCount;
    const idle = pool.idleCount;
    const waiting = pool.waitingCount;
    const active = Math.max(total - idle, 0);
    const saturation = max === 0 ? 0 : Number(((total - idle) / max).toFixed(3));
    const snapshot: PoolMetrics = {
      name,
      total,
      idle,
      waiting,
      active,
      max,
      saturation,
      createdAt: metricsCache.get(name)?.createdAt ?? Date.now(),
    };
    metricsCache.set(name, snapshot);
    snapshots.push(snapshot);
  }
  return snapshots;
}

export function closeAllPools(): Promise<void[]> {
  return Promise.all(Array.from(registry.values()).map((pool) => pool.end())).then(() => []);
}
