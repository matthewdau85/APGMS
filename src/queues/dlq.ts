import { appPool } from "../db";

export interface DlqRecord<TPayload = any> {
  id: number;
  queue_name: string;
  payload: TPayload;
  error: string;
  attempts: number;
  created_at: string;
  last_error_at: string | null;
  processed_at: string | null;
}

let ensured = false;

async function ensureTable() {
  if (ensured) return;
  await appPool.query(`
    CREATE TABLE IF NOT EXISTS adapter_dlq (
      id BIGSERIAL PRIMARY KEY,
      queue_name TEXT NOT NULL,
      payload JSONB NOT NULL,
      error TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_error_at TIMESTAMPTZ,
      processed_at TIMESTAMPTZ
    );
  `);
  await appPool.query(`
    CREATE INDEX IF NOT EXISTS adapter_dlq_queue_idx
      ON adapter_dlq(queue_name, processed_at, created_at);
  `);
  ensured = true;
}

export async function pushDlq<TPayload>(queueName: string, payload: TPayload, error: unknown, attempts: number) {
  await ensureTable();
  await appPool.query(
    `INSERT INTO adapter_dlq(queue_name, payload, error, attempts, last_error_at)
     VALUES ($1, $2, $3, $4, now())`,
    [queueName, payload, serializeError(error), attempts]
  );
}

export async function listDlq<TPayload>(queueName: string, limit = 50): Promise<DlqRecord<TPayload>[]> {
  await ensureTable();
  const { rows } = await appPool.query(
    `SELECT id, queue_name, payload, error, attempts, created_at, last_error_at, processed_at
       FROM adapter_dlq
      WHERE queue_name = $1 AND processed_at IS NULL
      ORDER BY created_at ASC
      LIMIT $2`,
    [queueName, limit]
  );
  return rows;
}

export async function markDlqProcessed(id: number) {
  await ensureTable();
  await appPool.query(`UPDATE adapter_dlq SET processed_at = now() WHERE id = $1`, [id]);
}

export async function touchDlqFailure(id: number, error: unknown) {
  await ensureTable();
  await appPool.query(
    `UPDATE adapter_dlq
        SET attempts = attempts + 1,
            error = $2,
            last_error_at = now()
      WHERE id = $1`,
    [id, serializeError(error)]
  );
}

export async function clearDlq(queueName: string) {
  await ensureTable();
  await appPool.query(`DELETE FROM adapter_dlq WHERE queue_name = $1`, [queueName]);
}

function serializeError(err: unknown): string {
  if (err instanceof Error) {
    return `${err.name}: ${err.message}`;
  }
  return typeof err === "string" ? err : JSON.stringify(err);
}
