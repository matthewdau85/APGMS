import { Pool, PoolClient } from "pg";
import { sha256Hex } from "../crypto/merkle";
import { getPool } from "../db/pool";

type Queryable = Pool | PoolClient;

function runner(client?: PoolClient): Queryable {
  return client ?? getPool();
}

export async function appendAudit(actor: string, action: string, payload: any, client?: PoolClient) {
  const q = runner(client);
  const { rows } = await q.query("select terminal_hash from audit_log order by seq desc limit 1");
  const prevHash = rows[0]?.terminal_hash || "";
  const payloadHash = sha256Hex(JSON.stringify(payload));
  const terminalHash = sha256Hex(prevHash + payloadHash);
  await q.query(
    "insert into audit_log(actor,action,payload_hash,prev_hash,terminal_hash) values ($1,$2,$3,$4,$5)",
    [actor, action, payloadHash, prevHash, terminalHash]
  );
  return terminalHash;
}
