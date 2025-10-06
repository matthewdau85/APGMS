import { setGauge } from "./index";

const HELP_TOTAL = "Total PostgreSQL clients tracked by the pool";
const HELP_IDLE = "Idle PostgreSQL clients available in the pool";
const HELP_WAITING = "Awaiting callers queued for a PostgreSQL client";
const HELP_SATURATION = "Fraction of available PostgreSQL clients currently in use";

export function publishPoolMetrics(stats: { total: number; idle: number; waiting: number }, max: number) {
  const safeMax = max > 0 ? max : 1;
  const inUse = stats.total - stats.idle;
  const saturation = Math.min(1, inUse / safeMax);
  setGauge("pg_pool_total_clients", stats.total, HELP_TOTAL);
  setGauge("pg_pool_idle_clients", stats.idle, HELP_IDLE);
  setGauge("pg_pool_waiting_clients", stats.waiting, HELP_WAITING);
  setGauge("pg_pool_saturation", Number.isFinite(saturation) ? saturation : 0, HELP_SATURATION);
}
