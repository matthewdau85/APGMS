import { Pool, PoolClient } from "pg";
import { sha256Hex } from "../crypto/merkle";

const pool = new Pool();

type Queryable = Pick<Pool, "query"> | PoolClient;

/**
 * Append an audit entry using the schema defined in 002_apgms_patent_core.sql.
 *
 * When a PoolClient is supplied the insert participates in the caller's
 * transaction which lets callers update business tables and the audit log
 * atomically.
 */
export async function appendAudit(
  category: string,
  message: unknown,
  client?: PoolClient
): Promise<string> {
  const runner: Queryable = client ?? pool;
  const messageText = typeof message === "string" ? message : JSON.stringify(message);

  const { rows } = await runner.query(
    "SELECT hash_this FROM audit_log ORDER BY id DESC LIMIT 1"
  );
  const hashPrev = rows[0]?.hash_this ?? "";
  const payloadHash = sha256Hex(messageText);
  const hashThis = sha256Hex(hashPrev + payloadHash);

  const inserted = await runner.query(
    "INSERT INTO audit_log(category,message,hash_prev,hash_this) VALUES ($1,$2,$3,$4) RETURNING hash_this",
    [category, messageText, hashPrev || null, hashThis]
  );

  return inserted.rows[0].hash_this as string;
}
