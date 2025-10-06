import crypto from "crypto";
import pg from "pg";
const { Pool } = pg;

interface AuditEntry {
  actor: string;
  action: string;
  target?: string | null;
  payload?: unknown;
}

interface AuditRow {
  id: number;
  hash: string;
  prev_hash: string | null;
  payload: unknown;
}

const connectionString = process.env.DATABASE_URL;
let pool: pg.Pool | null = null;

const memoryLog: AuditRow[] = [];

function ensurePool() {
  if (!connectionString) return null;
  if (!pool) {
    pool = new Pool({ connectionString });
  }
  return pool;
}

async function ensureTable(client: pg.PoolClient) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id BIGSERIAL PRIMARY KEY,
      ts TIMESTAMPTZ DEFAULT now(),
      actor TEXT NOT NULL,
      action TEXT NOT NULL,
      target TEXT,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      prev_hash TEXT,
      hash TEXT NOT NULL
    )
  `);
}

function payloadHash(payload: unknown) {
  const body = JSON.stringify(payload ?? {});
  return crypto.createHash("sha256").update(body).digest("hex");
}

function computeHash(prevHash: string | null, actor: string, action: string, target: string | null, payload: unknown) {
  const bodyHash = payloadHash(payload);
  const input = `${prevHash ?? ""}|${actor}|${action}|${target ?? ""}|${bodyHash}`;
  return crypto.createHash("sha256").update(input).digest("hex");
}

export async function appendAudit({ actor, action, target = null, payload }: AuditEntry) {
  const activePool = ensurePool();
  if (!activePool) {
    const prev = memoryLog[memoryLog.length - 1]?.hash ?? null;
    const hash = computeHash(prev, actor, action, target, payload);
    memoryLog.push({
      id: memoryLog.length + 1,
      hash,
      prev_hash: prev,
      payload,
    });
    return { hash, prevHash: prev };
  }

  const client = await activePool.connect();
  try {
    await client.query("BEGIN");
    await ensureTable(client);
    const { rows } = await client.query<{ hash: string }>(
      "SELECT hash FROM audit_log ORDER BY id DESC LIMIT 1 FOR UPDATE"
    );
    const prev = rows[0]?.hash ?? null;
    const hash = computeHash(prev, actor, action, target, payload);
    await client.query(
      `INSERT INTO audit_log(actor, action, target, payload, prev_hash, hash)
       VALUES ($1,$2,$3,$4,$5,$6)`
      , [actor, action, target, JSON.stringify(payload ?? {}), prev, hash]
    );
    await client.query("COMMIT");
    return { hash, prevHash: prev };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export function getAuditMemory() {
  return memoryLog;
}

export function resetAuditMemory() {
  memoryLog.splice(0, memoryLog.length);
}
