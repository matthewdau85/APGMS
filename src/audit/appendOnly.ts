import { sha256Hex } from "../crypto/merkle";
import { Pool } from "pg";
import type { AuthContext } from "../middleware/auth";

const pool = new Pool();

export interface AuditEvent {
  actor: Pick<AuthContext, "userId" | "roles" | "displayName"> | AuthContext;
  action: string;
  resource?: Record<string, any>;
  payload?: Record<string, any>;
  metadata?: Record<string, any>;
  result?: string;
  requestId?: string;
  requestIp?: string;
  occurredAt?: Date;
}

export async function appendAudit(event: AuditEvent) {
  const occurredAt = event.occurredAt ?? new Date();
  const { rows } = await pool.query("select terminal_hash from audit_log order by seq desc limit 1");
  const prevHash = rows[0]?.terminal_hash || "";
  const body = {
    resource: event.resource,
    payload: event.payload,
    metadata: event.metadata,
    result: event.result,
    requestId: event.requestId,
    requestIp: event.requestIp,
    occurredAt: occurredAt.toISOString(),
  };
  const payloadHash = sha256Hex(JSON.stringify(body));
  const actorRoles = Array.from(new Set(event.actor.roles));
  const terminalHash = sha256Hex(prevHash + payloadHash);
  await pool.query(
    "insert into audit_log(actor,actor_roles,action,payload_hash,prev_hash,terminal_hash,body) values ($1,$2,$3,$4,$5,$6,$7)",
    [
      event.actor.userId,
      actorRoles,
      event.action,
      payloadHash,
      prevHash,
      terminalHash,
      body,
    ],
  );
  return { terminalHash, payloadHash };
}
