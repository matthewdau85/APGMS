import type { Pool, PoolClient } from "pg";
import { pool } from "../db/pool";
import { sha256Hex } from "../crypto/merkle";

export interface AuditEntry {
  actorId?: string | null;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  payload: any;
}

export async function appendAudit(entry: AuditEntry, client?: Pool | PoolClient) {
  const runner = client ?? pool;
  const { rows } = await runner.query<{ hash: string }>(
    "SELECT hash FROM audit_log ORDER BY id DESC LIMIT 1"
  );
  const prevHash = rows[0]?.hash ?? "";
  const record = {
    prev_hash: prevHash,
    actor_id: entry.actorId ?? null,
    action: entry.action,
    target_type: entry.targetType ?? null,
    target_id: entry.targetId ?? null,
    payload: entry.payload,
  };
  const hash = sha256Hex(JSON.stringify(record));
  await runner.query(
    `INSERT INTO audit_log (actor_id, action, target_type, target_id, payload, prev_hash, hash)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [record.actor_id, record.action, record.target_type, record.target_id, record.payload, prevHash, hash]
  );
  return hash;
}
