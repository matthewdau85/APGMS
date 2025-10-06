import { pool } from "../db/pool";
import { sha256Hex } from "../crypto/merkle";

export async function appendAudit(actor: string, action: string, payload: unknown) {
  const { rows } = await pool.query<{ terminal_hash: string }>(
    "SELECT terminal_hash FROM audit_log ORDER BY seq DESC LIMIT 1"
  );
  const prevHash = rows[0]?.terminal_hash || "";
  const payloadJson = JSON.stringify(payload);
  const payloadHash = sha256Hex(payloadJson);
  const terminalHash = sha256Hex(prevHash + payloadHash);

  await pool.query(
    `INSERT INTO audit_log(actor, action, payload_hash, prev_hash, terminal_hash)
     VALUES ($1, $2, $3, $4, $5)`,
    [actor, action, payloadHash, prevHash || null, terminalHash]
  );

  return terminalHash;
}
