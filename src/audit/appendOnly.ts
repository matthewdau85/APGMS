import { sha256Hex } from "../crypto/merkle";
import { getPool } from "../db/pool";

export async function appendAudit(actor: string, action: string, payload: any) {
  const pool = getPool();
  const { rows } = await pool.query("select terminal_hash from audit_log order by seq desc limit 1");
  const prevHash = rows[0]?.terminal_hash || "";
  const payloadHash = sha256Hex(JSON.stringify(payload));
  const terminalHash = sha256Hex(prevHash + payloadHash);
  await pool.query(
    "insert into audit_log(actor,action,payload_hash,prev_hash,terminal_hash) values ($1,$2,$3,$4,$5)",
    [actor, action, payloadHash, prevHash, terminalHash]
  );
  return terminalHash;
}
