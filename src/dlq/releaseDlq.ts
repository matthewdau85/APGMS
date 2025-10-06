import { pool } from "../db/pool";
import { setGauge } from "../metrics";
import type { ReleaseJobPayload } from "../queues/releaseQueue";

const TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS bank_release_dlq (
    id BIGSERIAL PRIMARY KEY,
    transfer_uuid UUID UNIQUE NOT NULL,
    abn TEXT NOT NULL,
    tax_type TEXT NOT NULL,
    period_id TEXT NOT NULL,
    payload JSONB NOT NULL,
    error TEXT NOT NULL,
    attempts INTEGER NOT NULL,
    first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_error_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )
`;

let ensured = false;
setGauge("release_dlq_depth", 0, "Outstanding release jobs in the DLQ");

async function ensureTable() {
  if (ensured) return;
  await pool.query(TABLE_SQL);
  ensured = true;
}

export async function recordDeadLetter(payload: ReleaseJobPayload, error: unknown, attempts: number) {
  await ensureTable();
  const errText = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  await pool.query(
    `INSERT INTO bank_release_dlq (transfer_uuid, abn, tax_type, period_id, payload, error, attempts)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (transfer_uuid)
     DO UPDATE SET payload=EXCLUDED.payload, error=EXCLUDED.error, attempts=EXCLUDED.attempts, last_error_at=now()`,
    [payload.transferUuid, payload.abn, payload.taxType, payload.periodId, payload, errText, attempts]
  );
}

export async function markIdempotencyStatus(key: string, status: string) {
  await pool.query(
    `INSERT INTO idempotency_keys(key, last_status)
     VALUES ($1,$2)
     ON CONFLICT (key) DO UPDATE SET last_status=EXCLUDED.last_status`,
    [key, status]
  );
}

export namespace ReleaseDeadLetterEntry {
  export async function fetch(limit: number) {
    await ensureTable();
    const rows = await pool.query<{
      id: number;
      transfer_uuid: string;
      payload: ReleaseJobPayload;
      attempts: number;
      error: string;
    }>(
      `SELECT id, transfer_uuid, payload, attempts, error
       FROM bank_release_dlq
       ORDER BY first_seen_at ASC
       LIMIT $1`,
      [limit]
    );
    return rows.rows.map((row) => ({
      id: row.id,
      payload: row.payload,
      attempts: row.attempts,
      error: row.error,
    }));
  }

  export async function consume(id: number) {
    await ensureTable();
    await pool.query(`DELETE FROM bank_release_dlq WHERE id=$1`, [id]);
  }
}

export async function refreshDlqDepthMetric() {
  await ensureTable();
  const { rows } = await pool.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM bank_release_dlq`);
  const count = Number(rows[0]?.count ?? "0");
  setGauge("release_dlq_depth", count, "Outstanding release jobs in the DLQ");
}
