import { v4 as uuidv4 } from "uuid";
import { appendAudit } from "../audit/appendOnly";
import { sha256Hex } from "../crypto/merkle";
import { q, tx } from "../db";

type Rail = "EFT" | "BPAY";

export const SQL_SELECT_DESTINATION =
  "SELECT * FROM remittance_destinations WHERE abn=$1 AND rail=$2 AND reference=$3";
export const SQL_INSERT_IDEMPOTENCY_KEY =
  "INSERT INTO idempotency_keys(key,last_status) VALUES ($1,$2)";
export const SQL_SELECT_LEDGER_TAIL =
  "SELECT balance_after_cents, hash_after FROM owa_ledger WHERE abn=$1 AND tax_type=$2 AND period_id=$3 ORDER BY id DESC LIMIT 1";
export const SQL_INSERT_LEDGER_RELEASE =
  "INSERT INTO owa_ledger(abn,tax_type,period_id,transfer_uuid,amount_cents,balance_after_cents,bank_receipt_hash,prev_hash,hash_after) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)";
export const SQL_UPDATE_IDEMPOTENCY_DONE =
  "UPDATE idempotency_keys SET last_status=$2, response_hash=$3 WHERE key=$1";

class DuplicateIdempotencyError extends Error {
  constructor(public readonly key: string) {
    super("IDEMPOTENCY_CONFLICT");
  }
}

/** Allow-list enforcement and PRN/CRN lookup */
export async function resolveDestination(abn: string, rail: Rail, reference: string) {
  const { rows } = await q(SQL_SELECT_DESTINATION, [abn, rail, reference]);
  if (rows.length === 0) throw new Error("DEST_NOT_ALLOW_LISTED");
  return rows[0];
}

/** Idempotent release with a stable transfer_uuid (simulate bank release) */
export async function releasePayment(
  abn: string,
  taxType: string,
  periodId: string,
  amountCents: number,
  rail: Rail,
  reference: string
) {
  const transfer_uuid = uuidv4();
  try {
    return await tx(async (client) => {
      await client.query(SQL_INSERT_IDEMPOTENCY_KEY, [transfer_uuid, "INIT"]).catch((err: any) => {
        if (err?.code === "23505") {
          throw new DuplicateIdempotencyError(transfer_uuid);
        }
        throw err;
      });

      const { rows } = await client.query<{ balance_after_cents: number; hash_after: string | null }>(
        SQL_SELECT_LEDGER_TAIL,
        [abn, taxType, periodId]
      );
      const prevBal = Number(rows[0]?.balance_after_cents ?? 0);
      const prevHash = rows[0]?.hash_after ?? "";
      const newBal = prevBal - amountCents;
      const bank_receipt_hash = "bank:" + transfer_uuid.slice(0, 12);
      const hashAfter = sha256Hex(prevHash + bank_receipt_hash + String(newBal));

      await client.query(SQL_INSERT_LEDGER_RELEASE, [
        abn,
        taxType,
        periodId,
        transfer_uuid,
        -amountCents,
        newBal,
        bank_receipt_hash,
        prevHash,
        hashAfter,
      ]);

      await appendAudit(
        "rails",
        "release",
        { abn, taxType, periodId, amountCents, rail, reference, bank_receipt_hash },
        client
      );

      await client.query(SQL_UPDATE_IDEMPOTENCY_DONE, [transfer_uuid, "DONE", null]);

      return { transfer_uuid, bank_receipt_hash };
    });
  } catch (err) {
    if (err instanceof DuplicateIdempotencyError) {
      return { transfer_uuid: err.key, status: "DUPLICATE" };
    }
    throw err;
  }
}
