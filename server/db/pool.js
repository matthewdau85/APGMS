const { Pool } = require('pg');

const globalKey = Symbol.for('apgms.server.pool');
const globalState = global;

const createConfig = () => {
  if (process.env.DATABASE_URL) {
    return { connectionString: process.env.DATABASE_URL };
  }
  const {
    PGHOST = '127.0.0.1',
    PGUSER = 'apgms',
    PGPASSWORD = 'apgms_pw',
    PGDATABASE = 'apgms',
    PGPORT = '5432',
  } = process.env;
  return {
    host: PGHOST,
    user: PGUSER,
    password: PGPASSWORD,
    database: PGDATABASE,
    port: Number(PGPORT),
  };
};

const attachDiagnostics = (pool, label) => {
  const configuredMax = Number(process.env.PGPOOL_MAX_CONNECTIONS || '');
  const maxConnections =
    Number.isFinite(configuredMax) && configuredMax > 0
      ? configuredMax
      : pool.options?.max ?? 10;
  pool.__apgmsMax = maxConnections;

  const diagnosticsEnabled =
    process.env.DB_POOL_DIAGNOSTICS === 'true' || process.env.NODE_ENV === 'test';
  if (!diagnosticsEnabled) return;

  const logState = (event) => {
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

  pool.on('connect', () => logState('connect'));
  pool.on('acquire', () => logState('acquire'));
  pool.on('remove', () => logState('remove'));
  logState('bootstrap');

  const intervalMs = Number(process.env.DB_POOL_DIAGNOSTIC_INTERVAL_MS ?? '15000');
  if (Number.isFinite(intervalMs) && intervalMs > 0) {
    const timer = setInterval(() => logState('interval'), intervalMs);
    if (typeof timer.unref === 'function') timer.unref();
  }
};

if (!globalState[globalKey]) {
  const pool = new Pool(createConfig());
  attachDiagnostics(pool, 'express-db');
  globalState[globalKey] = pool;
}

const pool = globalState[globalKey];

const getPool = () => pool;

const getPoolMetrics = () => {
  const max = pool.__apgmsMax ?? pool.options?.max ?? 10;
  return {
    total: pool.totalCount,
    idle: pool.idleCount,
    waiting: pool.waitingCount,
    active: pool.totalCount - pool.idleCount,
    max,
  };
};

module.exports = { pool, getPool, getPoolMetrics };
