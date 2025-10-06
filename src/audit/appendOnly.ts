import { Pool } from "pg";
import { sha256Hex } from "../crypto/merkle";

const pool = new Pool();

export type AuditDigestInput = {
  at: Date | string;
  actor: string;
  action: string;
  payload: unknown;
};

export type AuditLogEntry = {
  id: number;
  at: string;
  actor: string;
  action: string;
  payload: any;
  prevHash: string;
  runningHash: string;
  entryHash: string;
};

export type AuditBundle = {
  period: string;
  entries: AuditLogEntry[];
  runningHash: string;
};

export function computeEntryDigest({ at, actor, action, payload }: AuditDigestInput): string {
  const isoAt = typeof at === "string" ? new Date(at).toISOString() : at.toISOString();
  const normalized = JSON.stringify({ at: isoAt, actor, action, payload });
  return sha256Hex(normalized);
}

export function computeRunningDigest(prevHash: string, entryDigest: string): string {
  return sha256Hex((prevHash || "") + entryDigest);
}

export async function appendAudit(actor: string, action: string, payload: any) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: prevRows } = await client.query<{ running_hash: string | null }>(
      "SELECT running_hash FROM audit_log ORDER BY id DESC LIMIT 1"
    );
    const prevRunningHash = prevRows[0]?.running_hash ?? "";
    const at = new Date();
    const entryHash = computeEntryDigest({ at, actor, action, payload });
    const runningHash = computeRunningDigest(prevRunningHash, entryHash);
    const payloadJson = JSON.stringify(payload ?? {});
    const { rows } = await client.query<{
      id: number;
      at: string;
      actor: string;
      action: string;
      payload_json: any;
      prev_hash: string | null;
      running_hash: string;
    }>(
      `INSERT INTO audit_log (at, actor, action, payload_json, prev_hash, running_hash)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6)
       RETURNING id, at, actor, action, payload_json, prev_hash, running_hash`,
      [at, actor, action, payloadJson, prevRunningHash || null, runningHash]
    );
    await client.query("COMMIT");
    const row = rows[0];
    const payloadValue = typeof row.payload_json === "string" ? JSON.parse(row.payload_json) : row.payload_json;
    return {
      id: row.id,
      at: new Date(row.at).toISOString(),
      actor: row.actor,
      action: row.action,
      payload: payloadValue,
      prevHash: row.prev_hash ?? "",
      runningHash: row.running_hash,
      entryHash,
    } satisfies AuditLogEntry;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function resolvePeriod(period: string): Promise<string> {
  if (period !== "latest") return period;
  const { rows } = await pool.query<{ period_id: string | null }>(
    `SELECT payload_json->>'periodId' AS period_id
       FROM audit_log
      WHERE payload_json ? 'periodId'
      ORDER BY id DESC
      LIMIT 1`
  );
  return rows[0]?.period_id ?? "all";
}

export async function getAuditBundle(period: string): Promise<AuditBundle> {
  const resolvedPeriod = await resolvePeriod(period);
  const isAll = resolvedPeriod === "all";
  const sql =
    "SELECT id, at, actor, action, payload_json, prev_hash, running_hash FROM audit_log" +
    (isAll ? " ORDER BY id ASC" : " WHERE payload_json->>'periodId' = $1 ORDER BY id ASC");
  const params = isAll ? [] : [resolvedPeriod];
  const { rows } = await pool.query<{
    id: number;
    at: string;
    actor: string;
    action: string;
    payload_json: any;
    prev_hash: string | null;
    running_hash: string;
  }>(sql, params);

  const entries: AuditLogEntry[] = rows.map((row) => {
    const payloadValue =
      row.payload_json === null
        ? null
        : typeof row.payload_json === "string"
        ? JSON.parse(row.payload_json)
        : row.payload_json;
    const entryHash = computeEntryDigest({
      at: row.at,
      actor: row.actor,
      action: row.action,
      payload: payloadValue,
    });
    return {
      id: row.id,
      at: new Date(row.at).toISOString(),
      actor: row.actor,
      action: row.action,
      payload: payloadValue,
      prevHash: row.prev_hash ?? "",
      runningHash: row.running_hash ?? "",
      entryHash,
    };
  });

  const terminalHash =
    entries.length > 0
      ? entries[entries.length - 1].runningHash
      : (await pool
          .query<{ running_hash: string | null }>(
            "SELECT running_hash FROM audit_log ORDER BY id DESC LIMIT 1"
          ))
          .rows[0]?.running_hash ?? "";

  return {
    period: resolvedPeriod,
    entries,
    runningHash: terminalHash ?? "",
  };
}
