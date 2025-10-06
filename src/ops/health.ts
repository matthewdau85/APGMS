import type { Application, NextFunction, Request, Response } from "express";
import { Counter, Gauge, Registry, collectDefaultMetrics } from "prom-client";
import pgModule from "pg";
import type { Pool } from "pg";

type HttpLabelValues = {
  method: string;
  status_code: string;
  route: string;
};

const registry = new Registry();
collectDefaultMetrics({ register: registry });

const httpRequestsTotal = new Counter<HttpLabelValues>({
  name: "http_requests_total",
  help: "Total number of HTTP requests handled by the server.",
  labelNames: ["method", "status_code", "route"],
  registers: [registry],
});

const httpActiveRequests = new Gauge<{ method: string }>({
  name: "http_requests_in_flight",
  help: "Number of HTTP requests currently in-flight.",
  labelNames: ["method"],
  registers: [registry],
});

type PoolLabel = { pool: string };

type TrackedPool = {
  pool: Pool;
  label: PoolLabel;
};

const trackedPools = new Set<TrackedPool>();

const pgPoolTotal = new Gauge<PoolLabel>({
  name: "pg_pool_total_clients",
  help: "Total number of PostgreSQL clients in the pool.",
  labelNames: ["pool"],
  registers: [registry],
});

const pgPoolIdle = new Gauge<PoolLabel>({
  name: "pg_pool_idle_clients",
  help: "Number of idle PostgreSQL clients in the pool.",
  labelNames: ["pool"],
  registers: [registry],
});

const pgPoolActive = new Gauge<PoolLabel>({
  name: "pg_pool_active_clients",
  help: "Number of active PostgreSQL clients checked out from the pool.",
  labelNames: ["pool"],
  registers: [registry],
});

const pgPoolWaiting = new Gauge<PoolLabel>({
  name: "pg_pool_waiting_clients",
  help: "Number of queued PostgreSQL acquire requests waiting for a client.",
  labelNames: ["pool"],
  registers: [registry],
});

function refreshPoolMetrics(): void {
  for (const tracked of trackedPools) {
    const { pool, label } = tracked;
    pgPoolTotal.set(label, pool.totalCount);
    pgPoolIdle.set(label, pool.idleCount);
    pgPoolActive.set(label, Math.max(pool.totalCount - pool.idleCount, 0));
    pgPoolWaiting.set(label, pool.waitingCount ?? 0);
  }
}

function nameForPool(pool: Pool, explicit?: string): string {
  if (explicit) {
    return explicit;
  }

  const options = (pool as unknown as { options?: Record<string, unknown> }).options ?? {};
  const { database, application_name: appName, connectionString } = options as {
    database?: string;
    application_name?: string;
    connectionString?: string;
  };

  return (
    (appName as string | undefined) ||
    (database as string | undefined) ||
    (connectionString as string | undefined) ||
    `pool-${trackedPools.size + 1}`
  );
}

function ensurePoolTracked(pool: Pool, labelName?: string): void {
  for (const tracked of trackedPools) {
    if (tracked.pool === pool) {
      return;
    }
  }

  const label: PoolLabel = { pool: nameForPool(pool, labelName) };
  const tracked: TrackedPool = { pool, label };
  trackedPools.add(tracked);

  const update = () => refreshPoolMetrics();

  pool.on("connect", update);
  pool.on("acquire", update);
  pool.on("release", update);
  pool.on("remove", update);
  pool.on("error", update);

  const originalEnd = pool.end.bind(pool);
  pool.end = (...args: Parameters<Pool["end"]>): ReturnType<Pool["end"]> => {
    const result = originalEnd(...args);

    if (typeof (result as Promise<unknown>).finally === "function") {
      (result as Promise<unknown>).finally(() => {
        trackedPools.delete(tracked);
        refreshPoolMetrics();
      });
    } else {
      trackedPools.delete(tracked);
      refreshPoolMetrics();
    }

    return result;
  };

  refreshPoolMetrics();
}

const instrumentedPools = new WeakSet<Pool>();

function patchPoolPrototype(PoolCtor: typeof pgModule.Pool): void {
  if ((PoolCtor.prototype as Record<string, unknown>).__metricsPatched) {
    return;
  }

  const originalConnect = PoolCtor.prototype.connect as Pool["connect"];
  PoolCtor.prototype.connect = function patchedConnect(
    this: Pool,
    ...args: Parameters<Pool["connect"]>
  ) {
    ensurePoolTracked(this);
    return originalConnect.apply(this, args);
  } as Pool["connect"];

  (PoolCtor.prototype as Record<string, unknown>).__metricsPatched = true;
}

export function instrumentPgPool(pool: Pool, label?: string): void {
  if (!instrumentedPools.has(pool)) {
    instrumentedPools.add(pool);
    ensurePoolTracked(pool, label);
  }
}

if (pgModule?.Pool) {
  patchPoolPrototype(pgModule.Pool);
}

export const httpMetrics: (req: Request, res: Response, next: NextFunction) => void = (
  req,
  res,
  next,
) => {
  const methodLabel = req.method.toUpperCase();
  httpActiveRequests.labels(methodLabel).inc();

  const end = () => {
    res.removeListener("close", end);
    res.removeListener("finish", end);
    const route = (req.route?.path as string | undefined) ?? req.path ?? req.url ?? "unknown";
    httpRequestsTotal.labels(methodLabel, String(res.statusCode), route).inc();
    httpActiveRequests.labels(methodLabel).dec();
  };

  res.on("finish", end);
  res.on("close", end);

  next();
};

export function registerHealthEndpoints(app: Application): void {
  app.get("/healthz", (_req, res) => {
    res.json({ ok: true });
  });

  app.get("/metrics", async (_req, res) => {
    refreshPoolMetrics();
    res.setHeader("Content-Type", registry.contentType);
    res.send(await registry.metrics());
  });
}

export { registry as metricsRegistry };
