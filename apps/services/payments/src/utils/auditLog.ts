import type { PoolClient } from "pg";
import { sha256Hex } from "./crypto.js";

export async function appendAuditLog(
  client: PoolClient,
  category: string,
  payload: Record<string, unknown>
): Promise<{ hashPrev: string | null; hashThis: string }>
export async function appendAuditLog(
  client: PoolClient,
  category: string,
  payload: string
): Promise<{ hashPrev: string | null; hashThis: string }>
export async function appendAuditLog(
  client: PoolClient,
  category: string,
  payload: Record<string, unknown> | string
): Promise<{ hashPrev: string | null; hashThis: string }> {
  const message = typeof payload === "string" ? payload : JSON.stringify(payload);
  const { rows } = await client.query<{ hash_this: string | null }>(
    `SELECT hash_this FROM audit_log ORDER BY id DESC LIMIT 1`
  );
  const hashPrev = rows[0]?.hash_this ?? null;
  const hashThis = sha256Hex((hashPrev ?? "") + message);
  await client.query(
    `INSERT INTO audit_log (category, message, hash_prev, hash_this) VALUES ($1,$2,$3,$4)`,
    [category, message, hashPrev, hashThis]
  );
  return { hashPrev, hashThis };
}
