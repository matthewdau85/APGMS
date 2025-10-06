import pool from "../db/pool.js";
import { sha256Hex } from "../crypto/merkle";

export const SQL_SELECT_LAST_AUDIT = `
  SELECT terminal_hash
    FROM audit_log
   ORDER BY seq DESC
   LIMIT 1
`;

export const SQL_INSERT_AUDIT = `
  INSERT INTO audit_log (actor, action, payload_hash, prev_hash, terminal_hash)
  VALUES ($1, $2, $3, $4, $5)
`;

export async function appendAudit(actor: string, action: string, payload: any) {
  const { rows } = await pool.query(SQL_SELECT_LAST_AUDIT);
  const prevHash = rows[0]?.terminal_hash || "";
  const payloadHash = sha256Hex(JSON.stringify(payload));
  const terminalHash = sha256Hex(prevHash + payloadHash);
  await pool.query(SQL_INSERT_AUDIT, [actor, action, payloadHash, prevHash, terminalHash]);
  return terminalHash;
}
