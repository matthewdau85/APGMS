import { sha256Hex } from "../crypto/merkle";
import { pool } from "../db/pool";

export async function appendAudit(actor: string, action: string, payload: any) {
  const { rows } = await pool.query("select terminal_hash from audit_log order by seq desc limit 1");
  const prevHash = rows[0]?.terminal_hash || "";
  const payloadHash = sha256Hex(JSON.stringify(payload));
  const terminalHash = sha256Hex(prevHash + payloadHash);
  await pool.query(
    "insert into audit_log(actor,action,payload_hash,prev_hash,terminal_hash) values (,,,,)",
    [actor, action, payloadHash, prevHash, terminalHash]
  );
  return terminalHash;
}
