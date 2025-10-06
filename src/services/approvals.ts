import type { Pool, PoolClient } from "pg";
import { pool } from "../db/pool";
import { sha256Hex } from "../crypto/merkle";
import { appendAudit } from "../audit/appendOnly";

export interface ReleaseRequest {
  abn: string;
  taxType: string;
  periodId: string;
  amountCents: number;
}

export function computeReleaseHash(input: ReleaseRequest): string {
  return sha256Hex(JSON.stringify({
    abn: input.abn,
    taxType: input.taxType,
    periodId: input.periodId,
    amountCents: Math.abs(input.amountCents),
  }));
}

export async function recordApproval(
  release: ReleaseRequest,
  actorId: string,
  actorName: string | undefined,
  reason: string | undefined,
  client?: Pool | PoolClient
) {
  const normalized = { ...release, amountCents: Math.abs(release.amountCents) };
  const hash = computeReleaseHash(normalized);
  const payload = {
    ...normalized,
    hash,
    reason,
  };
  const runner = client ?? pool;
  await runner.query(
    `INSERT INTO release_approvals (release_hash, payload, actor_id, actor_name, reason)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (release_hash, actor_id)
     DO UPDATE SET payload = EXCLUDED.payload, reason = EXCLUDED.reason, actor_name = EXCLUDED.actor_name, created_at = now()` ,
    [hash, payload, actorId, actorName ?? null, reason ?? null]
  );
  await appendAudit({
    actorId,
    action: "release_approval",
    targetType: "release",
    targetId: hash,
    payload,
  }, runner);
  return hash;
}

export async function getApprovalsForHash(hash: string, ttlMinutes: number) {
  const { rows } = await pool.query(
    `SELECT actor_id, actor_name, reason, created_at
     FROM release_approvals
     WHERE release_hash = $1 AND created_at >= now() - ($2::int || ' minutes')::interval`,
    [hash, ttlMinutes]
  );
  return rows as Array<{ actor_id: string; actor_name: string | null; reason: string | null; created_at: Date }>;
}
