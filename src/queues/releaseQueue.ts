import crypto from "node:crypto";
import { pool } from "../db/pool";
import { appendAudit } from "../audit/appendOnly";
import { sha256Hex } from "../crypto/merkle";
import { incCounter, setGauge, resetCounter } from "../metrics";
import { RetryQueue, QueueState, QueueSaturatedError, DeadLetterError } from "./retryQueue";
import { recordDeadLetter, ReleaseDeadLetterEntry, refreshDlqDepthMetric, markIdempotencyStatus } from "../dlq/releaseDlq";

export type ReleaseRail = "EFT" | "BPAY";

export interface ReleaseJobPayload {
  abn: string;
  taxType: string;
  periodId: string;
  amountCents: number;
  rail: ReleaseRail;
  reference: string;
  transferUuid: string;
}

export interface ReleaseResult {
  transfer_uuid: string;
  bank_receipt_hash: string;
  balance_after_cents: number;
  idempotent?: boolean;
}

resetCounter("release_queue_retries_total", "Total release job retries");
resetCounter("release_queue_dead_letters_total", "Total release jobs routed to the DLQ");
resetCounter("release_queue_saturated_total", "Times release queue refused work due to saturation");

const queue = new RetryQueue<ReleaseJobPayload, ReleaseResult>({
  concurrency: Number(process.env.RELEASE_QUEUE_CONCURRENCY ?? 4),
  maxSize: Number(process.env.RELEASE_QUEUE_MAX_SIZE ?? 100),
  maxAttempts: Number(process.env.RELEASE_QUEUE_MAX_ATTEMPTS ?? 3),
  baseBackoffMs: Number(process.env.RELEASE_QUEUE_BACKOFF_BASE_MS ?? 200),
  maxBackoffMs: Number(process.env.RELEASE_QUEUE_BACKOFF_CAP_MS ?? 5_000),
  processor: processRelease,
  onPermanentFailure: async (payload, error, attempts) => {
    await recordDeadLetter(payload, error, attempts);
    await markIdempotencyStatus(payload.transferUuid, "FAILED_DLQ");
    incCounter("release_queue_dead_letters_total", 1, "Total release jobs routed to the DLQ");
    await refreshDlqDepthMetric();
  },
  onMetrics: publishQueueMetrics,
  onRetry: async (payload, _error, attempt) => {
    incCounter("release_queue_retries_total", 1, "Total release job retries");
    await markIdempotencyStatus(payload.transferUuid, "RETRYING");
  },
});

publishQueueMetrics(queue.snapshot());

export async function enqueueRelease(payload: Omit<ReleaseJobPayload, "transferUuid"> & { transferUuid?: string }) {
  const transferUuid = payload.transferUuid ?? crypto.randomUUID();
  await markIdempotencyStatus(transferUuid, "ENQUEUED");
  try {
    return await queue.enqueue({ ...payload, transferUuid });
  } catch (err) {
    if (err instanceof QueueSaturatedError) {
      await markIdempotencyStatus(transferUuid, "QUEUE_SATURATED");
      incCounter("release_queue_saturated_total", 1, "Times release queue refused work due to saturation");
    }
    throw err;
  }
}

export async function replayDeadLetters(limit: number, throttleMs: number) {
  const rows = await ReleaseDeadLetterEntry.fetch(limit);
  let lastResult: ReleaseResult | undefined;
  for (const row of rows) {
    await markIdempotencyStatus(row.payload.transferUuid, "REPLAYING");
    try {
      lastResult = await queue.enqueue(row.payload);
      await ReleaseDeadLetterEntry.consume(row.id);
      await markIdempotencyStatus(row.payload.transferUuid, "DONE");
      await refreshDlqDepthMetric();
      if (throttleMs > 0) await sleep(throttleMs);
    } catch (err) {
      if (err instanceof QueueSaturatedError) {
        incCounter("release_queue_saturated_total", 1, "Times release queue refused work due to saturation");
      }
      throw err;
    }
  }
  return lastResult;
}

export function publishReleaseQueueMetrics() {
  publishQueueMetrics(queue.snapshot());
}

function publishQueueMetrics(state: QueueState) {
  setGauge("release_queue_waiting", state.depth, "Jobs waiting in the release queue");
  setGauge("release_queue_active", state.active, "Jobs actively executing in the release queue");
  const saturation = state.maxSize === 0 ? 0 : Math.min(1, state.depth / state.maxSize);
  setGauge("release_queue_saturation", saturation, "Fraction of release queue capacity consumed");
}

async function processRelease(job: ReleaseJobPayload, attempt: number): Promise<ReleaseResult> {
  await markIdempotencyStatus(job.transferUuid, attempt === 1 ? "RUNNING" : "RETRYING");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: balRows } = await client.query<{ balance_after_cents: string | number; hash_after: string | null }>(
      `SELECT balance_after_cents, hash_after
       FROM owa_ledger
       WHERE abn=$1 AND tax_type=$2 AND period_id=$3
       ORDER BY id DESC
       LIMIT 1`,
      [job.abn, job.taxType, job.periodId]
    );
    const prevBal = balRows.length ? Number(balRows[0].balance_after_cents) : 0;
    if (prevBal < job.amountCents) {
      throw Object.assign(new Error("INSUFFICIENT_FUNDS"), { code: "INSUFFICIENT_FUNDS" });
    }
    const prevHash = balRows[0]?.hash_after ?? "";
    const newBal = prevBal - job.amountCents;
    const bankReceipt = "bank:" + job.transferUuid.slice(0, 12);
    const hashAfter = sha256Hex(prevHash + bankReceipt + String(newBal));

    const insertSql = `
      INSERT INTO owa_ledger
        (abn, tax_type, period_id, transfer_uuid, amount_cents, balance_after_cents,
         bank_receipt_hash, prev_hash, hash_after)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      RETURNING balance_after_cents
    `;
    try {
      const inserted = await client.query(insertSql, [
        job.abn,
        job.taxType,
        job.periodId,
        job.transferUuid,
        -Math.abs(job.amountCents),
        newBal,
        bankReceipt,
        prevHash,
        hashAfter,
      ]);
      await client.query("COMMIT");
      await appendAudit("rails", "release", {
        abn: job.abn,
        taxType: job.taxType,
        periodId: job.periodId,
        amountCents: job.amountCents,
        rail: job.rail,
        reference: job.reference,
        bank_receipt_hash: bankReceipt,
      });
      await markIdempotencyStatus(job.transferUuid, "DONE");
      return {
        transfer_uuid: job.transferUuid,
        bank_receipt_hash: bankReceipt,
        balance_after_cents: Number(inserted.rows[0].balance_after_cents),
      };
    } catch (err: any) {
      await client.query("ROLLBACK");
      if (err?.code === "23505") {
        const existing = await pool.query(
          "select balance_after_cents, bank_receipt_hash from owa_ledger where transfer_uuid=$1",
          [job.transferUuid]
        );
        await markIdempotencyStatus(job.transferUuid, "DONE");
        return {
          transfer_uuid: job.transferUuid,
          bank_receipt_hash: existing.rows[0]?.bank_receipt_hash ?? "",
          balance_after_cents: Number(existing.rows[0]?.balance_after_cents ?? newBal),
          idempotent: true,
        };
      }
      throw err;
    }
  } catch (err: any) {
    const status = err?.code === "INSUFFICIENT_FUNDS" ? "FAILED_FUNDS" : "ERROR";
    await markIdempotencyStatus(job.transferUuid, status);
    throw err;
  } finally {
    client.release();
  }
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export { QueueSaturatedError, DeadLetterError };
