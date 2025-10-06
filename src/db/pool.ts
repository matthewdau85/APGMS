import type { PoolConfig } from "pg";
import { Pool } from "pg";

const connectionString = process.env.DATABASE_URL;
const config: PoolConfig = connectionString ? { connectionString } : {};

export const pool = new Pool(config);

const metrics = {
  connects: 0,
  acquires: 0,
  releases: 0,
  removes: 0,
  errors: 0,
};

function logPoolState(event: string) {
  console.log(
    `[db:pool] ${event} total=${pool.totalCount} idle=${pool.idleCount} waiting=${pool.waitingCount} ` +
      `connects=${metrics.connects} acquires=${metrics.acquires} releases=${metrics.releases} removes=${metrics.removes} errors=${metrics.errors}`
  );
}

pool.on("connect", () => {
  metrics.connects += 1;
  logPoolState("connect");
});

pool.on("acquire", () => {
  metrics.acquires += 1;
  logPoolState("acquire");
});

pool.on("release", () => {
  metrics.releases += 1;
  logPoolState("release");
});

pool.on("remove", () => {
  metrics.removes += 1;
  logPoolState("remove");
});

pool.on("error", (error) => {
  metrics.errors += 1;
  console.error(`[db:pool] error: ${error.message}`);
  logPoolState("error");
});

export function getPoolMetrics() {
  return {
    ...metrics,
    total: pool.totalCount,
    idle: pool.idleCount,
    waiting: pool.waitingCount,
  };
}
