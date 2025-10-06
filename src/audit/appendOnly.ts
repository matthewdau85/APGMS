import { sha256Hex } from "../crypto/merkle";
import { pool } from "../db/pool";
import { sql } from "../db/sql";

export async function appendAudit(actor: string, action: string, payload: any) {
  const prevQuery = sql`SELECT terminal_hash FROM audit_log ORDER BY seq DESC LIMIT 1`;
  const { rows } = await pool.query(prevQuery.text, prevQuery.params);
  const prevHash = rows[0]?.terminal_hash || "";
  const payloadHash = sha256Hex(JSON.stringify(payload));
  const terminalHash = sha256Hex(prevHash + payloadHash);
  const insertAudit = sql`
    INSERT INTO audit_log(actor,action,payload_hash,prev_hash,terminal_hash)
    VALUES (${actor},${action},${payloadHash},${prevHash},${terminalHash})
  `;
  await pool.query(insertAudit.text, insertAudit.params);
  return terminalHash;
}
