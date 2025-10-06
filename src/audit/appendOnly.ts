import { pool } from "../db/pool";
import { insertAuditLog, selectAuditTerminalHash } from "../db/queries";
import { sha256Hex } from "../crypto/merkle";

export async function appendAudit(actor: string, action: string, payload: any) {
  const { rows } = await pool.query(selectAuditTerminalHash);
  const prevHash = rows[0]?.terminal_hash || "";
  const payloadHash = sha256Hex(JSON.stringify(payload));
  const terminalHash = sha256Hex(prevHash + payloadHash);
  await pool.query(insertAuditLog(actor, action, payloadHash, prevHash, terminalHash));
  return terminalHash;
}
