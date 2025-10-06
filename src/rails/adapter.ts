import { v4 as uuidv4 } from "uuid";
import { appendAudit } from "../audit/appendOnly";
import { sha256Hex } from "../crypto/merkle";
import { appPool } from "../db";
import { AdapterBackpressureError, AdapterQueue, registerQueue } from "../queues/adapterQueue";
import { pushDlq } from "../queues/dlq";
import { ChaosInducedError, isChaosEnabled } from "../utils/chaos";

export { AdapterBackpressureError } from "../queues/adapterQueue";

export type RailType = "EFT" | "BPAY";

interface ReleaseJobPayload {
  abn: string;
  taxType: string;
  periodId: string;
  amountCents: number;
  rail: RailType;
  reference: string;
}

interface ReleaseResult {
  transfer_uuid: string;
  bank_receipt_hash: string;
  status?: "DUPLICATE";
}

function parsePositive(value: string | undefined, fallback: number): number {
  const parsed = value !== undefined ? Number(value) : NaN;
  const normalized = Math.floor(Number(parsed));
  return Number.isFinite(normalized) && normalized > 0 ? normalized : fallback;
}

function parseNonNegative(value: string | undefined, fallback: number): number {
  const parsed = value !== undefined ? Number(value) : NaN;
  const normalized = Math.floor(Number(parsed));
  return Number.isFinite(normalized) && normalized >= 0 ? normalized : fallback;
}

const releaseQueue = new AdapterQueue<ReleaseJobPayload, ReleaseResult>({
  name: "release",
  concurrency: parsePositive(process.env.RELEASE_QUEUE_CONCURRENCY, 4),
  maxQueue: parsePositive(process.env.RELEASE_QUEUE_MAX, 200),
  retryAttempts: parseNonNegative(process.env.RELEASE_QUEUE_RETRIES, 3),
  baseRetryDelayMs: parsePositive(process.env.RELEASE_QUEUE_BASE_DELAY_MS, 200),
  maxRetryDelayMs: parsePositive(process.env.RELEASE_QUEUE_MAX_DELAY_MS, 2000),
  shouldRetry: (err) => isTransientError(err),
  onPermanentFailure: async (err, payload, attempts) => {
    await pushDlq("release", payload, err, attempts);
  },
});
registerQueue(releaseQueue);

/** Allow-list enforcement and PRN/CRN lookup */
export async function resolveDestination(abn: string, rail: RailType, reference: string) {
  const { rows } = await appPool.query(
    "select * from remittance_destinations where abn= and rail= and reference=",
    [abn, rail, reference]
  );
  if (rows.length === 0) throw new Error("DEST_NOT_ALLOW_LISTED");
  return rows[0];
}

/** Idempotent release with retry/backoff and DLQ on permanent failure */
export async function releasePayment(
  abn: string,
  taxType: string,
  periodId: string,
  amountCents: number,
  rail: RailType,
  reference: string
) {
  const payload: ReleaseJobPayload = { abn, taxType, periodId, amountCents, rail, reference };
  return releaseQueue.enqueue(payload, () => performRelease(payload));
}

async function performRelease(payload: ReleaseJobPayload): Promise<ReleaseResult> {
  const { abn, taxType, periodId, amountCents, rail, reference } = payload;

  if (isChaosEnabled("dbFailover")) {
    throw new ChaosInducedError("dbFailover", "Simulated database failover");
  }

  if (!Number.isFinite(amountCents) || amountCents <= 0) {
    throw new Error("INVALID_RELEASE_AMOUNT");
  }

  const transfer_uuid = uuidv4();
  let idempotencyInserted = false;
  try {
    await appPool.query("insert into idempotency_keys(key,last_status) values(,)", [transfer_uuid, "INIT"]);
    idempotencyInserted = true;
  } catch {
    return { transfer_uuid, bank_receipt_hash: "", status: "DUPLICATE" };
  }

  try {
    const { rows } = await appPool.query(
      "select balance_after_cents, hash_after from owa_ledger where abn= and tax_type= and period_id= order by id desc limit 1",
      [abn, taxType, periodId]
    );
    const prevBal = Number(rows[0]?.balance_after_cents ?? 0);
    const prevHash = rows[0]?.hash_after ?? "";

    if (isChaosEnabled("bankTimeout")) {
      throw new ChaosInducedError("bankTimeout", "Simulated banking timeout");
    }

    const bank_receipt_hash = "bank:" + transfer_uuid.slice(0, 12);
    const newBal = prevBal - amountCents;
    const hashAfter = sha256Hex(prevHash + bank_receipt_hash + String(newBal));

    await appPool.query(
      "insert into owa_ledger(abn,tax_type,period_id,transfer_uuid,amount_cents,balance_after_cents,bank_receipt_hash,prev_hash,hash_after) values (,,,,,,,,)",
      [abn, taxType, periodId, transfer_uuid, -amountCents, newBal, bank_receipt_hash, prevHash, hashAfter]
    );
    await appendAudit("rails", "release", { abn, taxType, periodId, amountCents, rail, reference, bank_receipt_hash });
    await appPool.query("update idempotency_keys set last_status= where key=", [transfer_uuid, "DONE"]);
    return { transfer_uuid, bank_receipt_hash };
  } catch (err) {
    if (idempotencyInserted) {
      await appPool.query("update idempotency_keys set last_status= where key=", [transfer_uuid, "ERRORED"]);
    }
    throw err;
  }
}

function isTransientError(err: unknown): boolean {
  if (err instanceof ChaosInducedError && (err.flag === "bankTimeout" || err.flag === "dbFailover")) return true;
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    if (msg.includes("timeout") || msg.includes("ecconnreset") || msg.includes("transient")) {
      return true;
    }
  }
  return false;
}
