import { v4 as uuidv4 } from "uuid";
import { appendAudit } from "../audit/appendOnly";
import { pool } from "../db/pool";
import {
  insertIdempotencyKey,
  insertOwaLedgerEntry,
  selectIdempotencyKey,
  selectLatestLedgerBalance,
  selectRemittanceDestination,
  updateIdempotencyOutcome,
} from "../db/queries";
import { sha256Hex } from "../crypto/merkle";

/** Allow-list enforcement and PRN/CRN lookup */
export async function resolveDestination(abn: string, rail: "EFT" | "BPAY", reference: string) {
  const { rows } = await pool.query(selectRemittanceDestination(abn, rail, reference));
  if (rows.length === 0) throw new Error("DEST_NOT_ALLOW_LISTED");
  return rows[0];
}

/** Idempotent release with a stable transfer_uuid (simulate bank release) */
export async function releasePayment(
  abn: string,
  taxType: string,
  periodId: string,
  amountCents: number,
  rail: "EFT" | "BPAY",
  reference: string,
) {
  const transfer_uuid = uuidv4();
  const scope = `rails:${abn}:${taxType}:${periodId}`;
  const inserted = await pool.query(insertIdempotencyKey(transfer_uuid, transfer_uuid, scope));
  if (inserted.rowCount === 0) {
    const existing = await pool.query(selectIdempotencyKey(transfer_uuid));
    const row = existing.rows[0];
    return {
      transfer_uuid,
      status: row?.response_status ? "DONE" : "DUPLICATE",
      bank_receipt_hash: row?.response_body?.bank_receipt_hash,
    };
  }
  const bank_receipt_hash = "bank:" + transfer_uuid.slice(0, 12);

  const { rows } = await pool.query(selectLatestLedgerBalance(abn, taxType, periodId));
  const prevBal = rows[0]?.balance_after_cents ?? 0;
  const prevHash = rows[0]?.hash_after ?? "";
  const newBal = prevBal - amountCents;
  const hashAfter = sha256Hex(prevHash + bank_receipt_hash + String(newBal));

  await pool.query(
    insertOwaLedgerEntry(abn, taxType, periodId, transfer_uuid, -amountCents, newBal, bank_receipt_hash, prevHash, hashAfter),
  );
  await appendAudit("rails", "release", { abn, taxType, periodId, amountCents, rail, reference, bank_receipt_hash });
  await pool.query(updateIdempotencyOutcome(transfer_uuid, 200, { bank_receipt_hash }, "SUCCESS"));
  return { transfer_uuid, bank_receipt_hash };
}
