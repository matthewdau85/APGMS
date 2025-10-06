import { v4 as uuidv4 } from "uuid";
import pool from "../db/pool.js";
import { appendAudit } from "../audit/appendOnly";
import { sha256Hex } from "../crypto/merkle";

export const SQL_SELECT_DESTINATION = `
  SELECT *
    FROM remittance_destinations
   WHERE abn = $1
     AND rail = $2
     AND reference = $3
`;

export const SQL_SELECT_LATEST_LEDGER = `
  SELECT balance_after_cents, hash_after
    FROM owa_ledger
   WHERE abn = $1
     AND tax_type = $2
     AND period_id = $3
   ORDER BY id DESC
   LIMIT 1
`;

export const SQL_INSERT_LEDGER_RELEASE = `
  INSERT INTO owa_ledger (
    abn,
    tax_type,
    period_id,
    transfer_uuid,
    amount_cents,
    balance_after_cents,
    bank_receipt_hash,
    prev_hash,
    hash_after
  )
  VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
  RETURNING transfer_uuid, balance_after_cents
`;

const SQL_SELECT_IDEMPOTENCY = `
  SELECT status_code, response
    FROM idempotency_keys
   WHERE key = $1
`;

const SQL_INSERT_IDEMPOTENCY = `
  INSERT INTO idempotency_keys (key, last_status, request_id)
  VALUES ($1, $2, $3)
  ON CONFLICT (key) DO NOTHING
`;

const SQL_UPDATE_IDEMPOTENCY = `
  UPDATE idempotency_keys
     SET last_status = $2,
         status_code = $3,
         response = $4,
         response_hash = $5,
         request_id = COALESCE($6, request_id),
         updated_at = now()
   WHERE key = $1
`;

/** Allow-list enforcement and PRN/CRN lookup */
export async function resolveDestination(abn: string, rail: "EFT" | "BPAY", reference: string) {
  const { rows } = await pool.query(SQL_SELECT_DESTINATION, [abn, rail, reference]);
  if (rows.length === 0) {
    const err = new Error("DEST_NOT_ALLOW_LISTED") as Error & { status?: number };
    err.status = 404;
    throw err;
  }
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
  requestId?: string
) {
  const idemKey = `release:${abn}:${taxType}:${periodId}`;
  const existing = await pool.query(SQL_SELECT_IDEMPOTENCY, [idemKey]);
  if (existing.rowCount > 0 && existing.rows[0].response) {
    return existing.rows[0].response.body ?? existing.rows[0].response;
  }

  await pool.query(SQL_INSERT_IDEMPOTENCY, [idemKey, "IN_PROGRESS", requestId ?? null]);

  const transfer_uuid = uuidv4();
  const bank_receipt_hash = "bank:" + transfer_uuid.slice(0, 12);

  const { rows } = await pool.query(SQL_SELECT_LATEST_LEDGER, [abn, taxType, periodId]);
  const prevBal = Number(rows[0]?.balance_after_cents ?? 0);
  const prevHash = rows[0]?.hash_after ?? "";
  const debit = Math.abs(Number(amountCents));
  if (prevBal < debit) {
    const err = new Error("INSUFFICIENT_OWA") as Error & { status?: number; details?: any };
    err.status = 422;
    err.details = { prevBal: String(prevBal), needed: debit };
    throw err;
  }
  const newBal = Number(prevBal) - debit;
  const hashAfter = sha256Hex(String(prevHash) + bank_receipt_hash + String(newBal));

  await pool.query(SQL_INSERT_LEDGER_RELEASE, [
    abn,
    taxType,
    periodId,
    transfer_uuid,
    -debit,
    newBal,
    bank_receipt_hash,
    prevHash,
    hashAfter
  ]);

  await appendAudit("rails", "release", { abn, taxType, periodId, amountCents, rail, reference, bank_receipt_hash });

  const responseBody = { transfer_uuid, bank_receipt_hash, new_balance: newBal };
  const payload = { statusCode: 200, body: responseBody };
  await pool.query(SQL_UPDATE_IDEMPOTENCY, [
    idemKey,
    "DONE",
    200,
    payload,
    sha256Hex(JSON.stringify(payload)),
    requestId ?? null
  ]);

  return responseBody;
}
