import { Pool, PoolClient } from "pg";
import { v4 as uuidv4 } from "uuid";
import { createHash } from "crypto";
import { appendAudit } from "../audit/appendOnly";
import { appendLedgerEntry, fetchLedgerTail } from "../../libs/patent/ledger.js";
import {
  resolveDestinationByReference,
  type RemittanceDestination,
} from "../../libs/patent/remittance.js";

const pool = new Pool();

export async function resolveDestination(abn: string, rail: "EFT" | "BPAY" | "PayTo", reference: string, db?: Pool | PoolClient): Promise<RemittanceDestination> {
  const queryer = db ?? pool;
  const dest = await resolveDestinationByReference(queryer, abn, rail, reference);
  if (!dest) throw new Error("DEST_NOT_ALLOW_LISTED");
  return dest;
}

export interface ReleaseRailContext {
  traceId: string;
  rail: "EFT" | "BPAY" | "PayTo";
  abn: string;
  taxType: string;
  periodId: string;
  amountCents: number;
  reference: string;
  destination: RemittanceDestination;
}

export interface ReleaseRailResult {
  providerReceiptId: string;
  transferUuid?: string;
  bankReceiptHash?: string;
}

export interface ReleaseOptions {
  callRail?: (ctx: ReleaseRailContext) => Promise<ReleaseRailResult>;
  idempotencyKey?: string;
  traceId?: string;
}

export interface ReleaseResult {
  status: "OK" | "DUPLICATE";
  transfer_uuid: string;
  release_uuid: string;
  bank_receipt_hash: string;
  provider_receipt_id?: string;
  trace_id: string;
  amount_cents: number;
  balance_after_cents?: number;
  rail: "EFT" | "BPAY" | "PayTo";
  reference: string;
}

function hashResponse(payload: Record<string, unknown>): string {
  const h = createHash("sha256");
  h.update(JSON.stringify(payload));
  return h.digest("hex");
}

export async function releasePayment(
  abn: string,
  taxType: string,
  periodId: string,
  amountCents: number,
  rail: "EFT" | "BPAY" | "PayTo",
  reference: string,
  options: ReleaseOptions = {}
): Promise<ReleaseResult> {
  if (amountCents <= 0) throw new Error("AMOUNT_MUST_BE_POSITIVE");
  const client = await pool.connect();
  const idempotencyKey = options.idempotencyKey ?? `release:${abn}:${taxType}:${periodId}`;
  const traceId = options.traceId ?? uuidv4();
  try {
    await client.query("BEGIN");
    const inserted = await client.query(
      "INSERT INTO idempotency_keys(key,last_status,response_hash) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING key",
      [idempotencyKey, "PENDING", null]
    );

    if (inserted.rowCount === 0) {
      const existing = await client.query("SELECT last_status FROM idempotency_keys WHERE key=$1 FOR UPDATE", [idempotencyKey]);
      if (existing.rowCount === 0) throw new Error("IDEMPOTENCY_STATE_MISSING");
      const status = existing.rows[0].last_status;
      if (status === "DONE") {
        const dup = await client.query(
          `SELECT transfer_uuid, release_uuid, bank_receipt_hash, bank_receipt_id, amount_cents, balance_after_cents
             FROM owa_ledger
            WHERE abn=$1 AND tax_type=$2 AND period_id=$3 AND amount_cents < 0
            ORDER BY id DESC LIMIT 1`,
          [abn, taxType, periodId]
        );
        await client.query("COMMIT");
        if (!dup.rowCount) throw new Error("IDEMPOTENCY_CONFLICT");
        const row = dup.rows[0];
        if (Math.abs(Number(row.amount_cents)) !== amountCents) throw new Error("IDEMPOTENCY_CONFLICT");
        return {
          status: "DUPLICATE",
          transfer_uuid: row.transfer_uuid,
          release_uuid: row.release_uuid,
          bank_receipt_hash: row.bank_receipt_hash,
          provider_receipt_id: row.bank_receipt_id ?? undefined,
          trace_id: traceId,
          amount_cents: amountCents,
          balance_after_cents: Number(row.balance_after_cents ?? 0),
          rail,
          reference,
        };
      }
      if (status !== "FAILED") {
        throw new Error("RELEASE_IN_PROGRESS");
      }
      await client.query("UPDATE idempotency_keys SET last_status=$2, response_hash=$3 WHERE key=$1", [idempotencyKey, "PENDING", null]);
    }

    const destination = await resolveDestination(abn, rail, reference, client);
    const tail = await fetchLedgerTail(client, abn, taxType, periodId);
    if (tail.balanceAfter < amountCents) {
      await client.query("UPDATE idempotency_keys SET last_status=$2 WHERE key=$1", [idempotencyKey, "FAILED"]);
      await client.query("ROLLBACK");
      throw new Error("INSUFFICIENT_FUNDS");
    }

    let railResult: ReleaseRailResult | null = null;
    if (options.callRail) {
      try {
        railResult = await options.callRail({ traceId, rail, abn, taxType, periodId, amountCents, reference, destination });
      } catch (err) {
        await client.query("UPDATE idempotency_keys SET last_status=$2 WHERE key=$1", [idempotencyKey, "FAILED"]);
        await client.query("ROLLBACK");
        throw err;
      }
    }

    const providerReceiptId = railResult?.providerReceiptId ?? `synthetic-${traceId.slice(0, 12)}`;
    const transferUuid = railResult?.transferUuid ?? uuidv4();
    const bankReceiptHash = railResult?.bankReceiptHash ?? createHash("sha256").update(providerReceiptId).digest("hex");
    const releaseUuid = uuidv4();

    const ledger = await appendLedgerEntry({
      client,
      abn,
      taxType,
      periodId,
      amountCents: -Math.abs(amountCents),
      transferUuid,
      bankReceiptHash,
      releaseUuid,
      rptVerified: true,
      bankReceiptId: providerReceiptId,
    });

    const responseHash = hashResponse({ transferUuid, releaseUuid, bankReceiptHash });
    await client.query("UPDATE idempotency_keys SET last_status=$2, response_hash=$3 WHERE key=$1", [idempotencyKey, "DONE", responseHash]);

    await appendAudit("rails", "release", {
      abn,
      taxType,
      periodId,
      amountCents,
      rail,
      reference,
      bank_receipt_hash: bankReceiptHash,
      trace_id: traceId,
    });

    await client.query("COMMIT");
    return {
      status: "OK",
      transfer_uuid: transferUuid,
      release_uuid: releaseUuid,
      bank_receipt_hash: bankReceiptHash,
      provider_receipt_id: providerReceiptId,
      trace_id: traceId,
      amount_cents: amountCents,
      balance_after_cents: ledger.balanceAfter,
      rail,
      reference,
    };
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore */
    }
    throw err;
  } finally {
    client.release();
  }
}
