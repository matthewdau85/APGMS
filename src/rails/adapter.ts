import { v4 as uuidv4 } from "uuid";
import { appendAudit } from "../audit/appendOnly";
import { sha256Hex } from "../crypto/merkle";
import { getPool } from "../db/pool";
import { recordShadowObservation, ProviderObservation } from "../shadow/observer";

const pool = getPool();

type Rail = "EFT" | "BPAY";

interface ReleaseResult {
  transfer_uuid: string;
  bank_receipt_hash: string;
}

interface ProviderReturn<T> {
  status: number;
  body: T;
  observationBody?: any;
}

interface ReleaseArgs {
  abn: string;
  taxType: string;
  periodId: string;
  amountCents: number;
  rail: Rail;
  reference: string;
  transferUuid: string;
}

interface Captured<T> {
  observation: ProviderObservation;
  result?: T;
  error?: any;
}

/** Allow-list enforcement and PRN/CRN lookup */
export async function resolveDestination(abn: string, rail: Rail, reference: string) {
  const { rows } = await pool.query(
    "select * from remittance_destinations where abn= and rail= and reference=",
    [abn, rail, reference]
  );
  if (rows.length === 0) throw new Error("DEST_NOT_ALLOW_LISTED");
  return rows[0];
}

export async function releasePayment(
  abn: string,
  taxType: string,
  periodId: string,
  amountCents: number,
  rail: Rail,
  reference: string
) {
  const transferUuid = uuidv4();
  const registered = await registerIdempotency(transferUuid);
  if (!registered) {
    return { transfer_uuid: transferUuid, status: "DUPLICATE" } as any;
  }

  const traceId = uuidv4();
  const args: ReleaseArgs = { abn, taxType, periodId, amountCents, rail, reference, transferUuid };
  const shadowEnabled = isShadowModeEnabled();

  const mockPromise = captureProviderCall(() => performMockRelease(args));
  const realPromise = shadowEnabled ? captureProviderCall(() => performRealRelease(args)) : undefined;

  const mockResult = await mockPromise;
  if (mockResult.error) {
    throw mockResult.error;
  }

  if (realPromise) {
    const realResult = await realPromise;
    try {
      await recordShadowObservation({
        traceId,
        operation: "releasePayment",
        mock: mockResult.observation,
        real: realResult.observation,
      });
    } catch (err) {
      console.error("[shadow] failed to record observation", err);
    }
  }

  return mockResult.result!;
}

const DUPLICATE_CODE = "23505";

async function registerIdempotency(key: string) {
  try {
    await pool.query("insert into idempotency_keys(key,last_status) values(,)", [key, "INIT"]);
    return true;
  } catch (err: any) {
    if (err && err.code === DUPLICATE_CODE) {
      return false;
    }
    throw err;
  }
}

async function updateIdempotencyStatus(key: string, status: string) {
  await pool.query("update idempotency_keys set last_status= where key=", [status, key]);
}

let chaosCounter = 0;

export function __resetShadowChaosCounter() {
  chaosCounter = 0;
}

function shouldInjectChaos() {
  const raw =
    process.env.SHADOW_MOCK_CHAOS_PCT || process.env.MOCK_SHADOW_CHAOS_PCT || process.env.MOCK_CHAOS_PCT;
  if (!raw) return false;
  const pct = Number(raw);
  if (!Number.isFinite(pct) || pct <= 0) return false;
  const interval = Math.max(1, Math.round(1 / pct));
  chaosCounter += 1;
  return chaosCounter % interval === 0;
}

function isShadowModeEnabled() {
  return (process.env.SHADOW_MODE || "").toLowerCase() === "true";
}

function toObservationBody<T>(result: ProviderReturn<T>) {
  if (result.observationBody !== undefined) return result.observationBody;
  return result.body;
}

async function captureProviderCall<T>(fn: () => Promise<ProviderReturn<T>>): Promise<Captured<T>> {
  const start = process.hrtime.bigint();
  try {
    const res = await fn();
    const latencyMs = elapsedMs(start);
    return {
      observation: { status: res.status, body: toObservationBody(res), latencyMs },
      result: res.body,
    };
  } catch (err: any) {
    const latencyMs = elapsedMs(start);
    const status = typeof err?.status === "number" ? err.status : 500;
    const body = err?.body ?? { error: err?.message ?? String(err) };
    return { observation: { status, body, latencyMs }, error: err };
  }
}

function elapsedMs(start: bigint) {
  const diff = process.hrtime.bigint() - start;
  return Number(diff) / 1_000_000;
}

async function performMockRelease(args: ReleaseArgs): Promise<ProviderReturn<ReleaseResult>> {
  const amount = Number(args.amountCents);
  const bankReceiptHash = "bank:" + args.transferUuid.slice(0, 12);
  const { rows } = await pool.query(
    "select balance_after_cents, hash_after from owa_ledger where abn= and tax_type= and period_id= order by id desc limit 1",
    [args.abn, args.taxType, args.periodId]
  );
  const prevBal = rows[0]?.balance_after_cents != null ? Number(rows[0].balance_after_cents) : 0;
  const prevHash = rows[0]?.hash_after ?? "";
  const newBal = prevBal - amount;
  const hashAfter = sha256Hex(prevHash + bankReceiptHash + String(newBal));

  try {
    await pool.query(
      "insert into owa_ledger(abn,tax_type,period_id,transfer_uuid,amount_cents,balance_after_cents,bank_receipt_hash,prev_hash,hash_after) values (,,,,,,,,)",
      [args.abn, args.taxType, args.periodId, args.transferUuid, -amount, newBal, bankReceiptHash, prevHash, hashAfter]
    );
    await appendAudit("rails", "release", {
      abn: args.abn,
      taxType: args.taxType,
      periodId: args.periodId,
      amountCents: amount,
      rail: args.rail,
      reference: args.reference,
      bank_receipt_hash: bankReceiptHash,
    });
    await updateIdempotencyStatus(args.transferUuid, "DONE");
  } catch (err) {
    await updateIdempotencyStatus(args.transferUuid, "ERROR");
    throw err;
  }

  const body: ReleaseResult = { transfer_uuid: args.transferUuid, bank_receipt_hash: bankReceiptHash };
  const observationBody = shouldInjectChaos() ? { ...body, chaos: true } : body;

  return { status: 200, body, observationBody };
}

async function performRealRelease(args: ReleaseArgs): Promise<ProviderReturn<ReleaseResult>> {
  const delayMs = Number(process.env.REAL_PROVIDER_LATENCY_MS ?? "0");
  if (Number.isFinite(delayMs) && delayMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  const bankReceiptHash = "bank:" + args.transferUuid.slice(0, 12);
  const body: ReleaseResult = { transfer_uuid: args.transferUuid, bank_receipt_hash: bankReceiptHash };
  return { status: 200, body };
}
