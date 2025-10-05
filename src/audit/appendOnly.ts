import type { PoolClient } from "pg";
import { sha256Hex } from "../crypto/merkle";
import { tx } from "../db";

export const SQL_SELECT_AUDIT_TAIL =
  "SELECT terminal_hash FROM audit_log ORDER BY seq DESC LIMIT 1";
export const SQL_INSERT_AUDIT_ENTRY =
  "INSERT INTO audit_log(actor,action,payload_hash,prev_hash,terminal_hash) VALUES ($1,$2,$3,$4,$5)";

async function appendAuditWithClient(
  client: PoolClient,
  actor: string,
  action: string,
  payload: any
) {
  const { rows } = await client.query<{ terminal_hash: string | null }>(
    SQL_SELECT_AUDIT_TAIL
  );
  const prevHash = rows[0]?.terminal_hash || "";
  const payloadHash = sha256Hex(JSON.stringify(payload));
  const terminalHash = sha256Hex(prevHash + payloadHash);
  await client.query(SQL_INSERT_AUDIT_ENTRY, [
    actor,
    action,
    payloadHash,
    prevHash,
    terminalHash,
  ]);
  return terminalHash;
}

export async function appendAudit(
  actor: string,
  action: string,
  payload: any,
  client?: PoolClient
) {
  if (client) {
    return appendAuditWithClient(client, actor, action, payload);
  }
  return tx((c) => appendAuditWithClient(c, actor, action, payload));
}
