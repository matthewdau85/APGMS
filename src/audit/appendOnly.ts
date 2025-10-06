import crypto from "crypto";
import { Pool, PoolClient } from "pg";

export interface AuditOptions {
  actor: string;
  action: string;
  target?: string | null;
  payload?: unknown;
}

const pool = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL })
  : new Pool();
let tableEnsured = false;

async function ensureTable(client: PoolClient) {
  if (tableEnsured) return;
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
  tableEnsured = true;
}

function computeHash(prev: string | null, actor: string, action: string, target: string | null, payload: unknown) {
  const payloadText = JSON.stringify(payload ?? {});
  const payloadHash = crypto.createHash("sha256").update(payloadText).digest("hex");
  const input = `${prev ?? ""}|${actor}|${action}|${target ?? ""}|${payloadHash}`;
  return crypto.createHash("sha256").update(input).digest("hex");
}

export async function appendAudit(actor: string, action: string, payload: unknown, target: string | null = null) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await ensureTable(client);
    const { rows } = await client.query<{ hash: string }>("SELECT hash FROM audit_log ORDER BY id DESC LIMIT 1 FOR UPDATE");
    const prev = rows[0]?.hash ?? null;
    const hash = computeHash(prev, actor, action, target, payload);
    await client.query(
      `INSERT INTO audit_log(actor, action, target, payload, prev_hash, hash)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [actor, action, target, JSON.stringify(payload ?? {}), prev, hash]
    );
    await client.query("COMMIT");
    return hash;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
