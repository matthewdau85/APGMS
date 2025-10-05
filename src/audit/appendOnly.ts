import { sha256Hex } from "../crypto/merkle";
import { Pool } from "pg";
const pool = new Pool();

export async function appendAudit(actor: string, action: string, payload: any) {
  const { rows } = await pool.query(
    "select coalesce(hash_this, terminal_hash) as prev_hash from audit_log order by seq desc limit 1"
  );
  const prevHash = rows[0]?.prev_hash || "";
  const payloadHash = sha256Hex(JSON.stringify(payload));
  const terminalHash = sha256Hex(prevHash + payloadHash);
  await pool.query(
    "insert into audit_log(actor,action,payload_hash,hash_prev,hash_this,prev_hash,terminal_hash) values ($1,$2,$3,$4,$5,$4,$5)",
    [actor, action, payloadHash, prevHash, terminalHash]
  );
  return terminalHash;
}
