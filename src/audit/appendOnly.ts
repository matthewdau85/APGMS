import { Pool, PoolClient } from "pg";
import { sha256Hex } from "../crypto/merkle";

const pool = new Pool();

export interface AuditEntry {
  who: string;
  what: string;
  old: unknown;
  new: unknown;
  requestId: string;
}

async function withClient<T>(fn: (client: PoolClient) => Promise<T>) {
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

export async function appendAudit(entry: AuditEntry) {
  return withClient(async client => {
    await client.query("BEGIN");
    try {
      const { rows } = await client.query<{ terminal_hash: string | null }>(
        "SELECT terminal_hash FROM audit_log ORDER BY seq DESC LIMIT 1 FOR UPDATE"
      );
      const prevHash = rows[0]?.terminal_hash ?? null;
      const payload = {
        who: entry.who,
        what: entry.what,
        old: entry.old,
        new: entry.new,
        requestId: entry.requestId,
      };
      const payloadHash = sha256Hex(JSON.stringify(payload));
      const terminalHash = sha256Hex((prevHash ?? "") + payloadHash);

      await client.query(
        `INSERT INTO audit_log(actor, action, payload_hash, prev_hash, terminal_hash, entry)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [entry.who, entry.what, payloadHash, prevHash, terminalHash, payload]
      );
      await client.query("COMMIT");
      return terminalHash;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    }
  });
}
