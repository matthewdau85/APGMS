import { randomUUID } from "crypto";
import { Pool } from "pg";
import { sha256Hex } from "../crypto/merkle";

const pool = new Pool();

let ensured = false;
async function ensureAuditTable() {
  if (ensured) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id BIGSERIAL PRIMARY KEY,
      ts TIMESTAMPTZ DEFAULT now(),
      request_id TEXT,
      actor TEXT NOT NULL,
      action TEXT NOT NULL,
      target TEXT,
      payload JSONB,
      prev_hash TEXT,
      hash TEXT NOT NULL
    )
  `);
  await pool.query(`ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS request_id TEXT`);
  await pool.query(`ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS target TEXT`);
  await pool.query(`ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS payload JSONB`);
  await pool.query(`ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS hash TEXT`);
  ensured = true;
}

export interface AuditEntry {
  actor: string;
  action: string;
  target?: string;
  payload?: unknown;
  requestId?: string;
}

export async function appendAudit(entry: AuditEntry) {
  await ensureAuditTable();
  const requestId = entry.requestId || randomUUID();
  const payloadValue = entry.payload === undefined ? null : entry.payload;
  const payloadJson = payloadValue === null ? null : JSON.stringify(payloadValue);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query<{ hash: string }>(
      "SELECT hash FROM audit_log ORDER BY id DESC LIMIT 1"
    );
    const prevHash = rows[0]?.hash || "";
    const material = JSON.stringify({
      prevHash,
      actor: entry.actor,
      action: entry.action,
      target: entry.target ?? null,
      payload: payloadJson,
      requestId,
    });
    const hash = sha256Hex(material);
    await client.query(
      `INSERT INTO audit_log (request_id, actor, action, target, payload, prev_hash, hash)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [requestId, entry.actor, entry.action, entry.target ?? null, payloadValue, prevHash || null, hash]
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
