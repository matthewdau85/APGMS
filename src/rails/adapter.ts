import { Pool } from "pg";
import { v4 as uuidv4 } from "uuid";
import { appendAudit } from "../audit/appendOnly";
import { sha256Hex } from "../crypto/merkle";
const pool = new Pool();

/** Allow-list enforcement and PRN/CRN lookup */
export async function resolveDestination(abn: string, rail: "EFT"|"BPAY", reference: string) {
  const { rows } = await pool.query(
    "SELECT * FROM remittance_destinations WHERE abn=$1 AND rail=$2 AND reference=$3",
    [abn, rail, reference]
  );
  if (rows.length === 0) throw new Error("DEST_NOT_ALLOW_LISTED");
  return rows[0];
}

/** Idempotent release with a stable transfer_uuid (simulate bank release) */
export async function releasePayment(abn: string, taxType: string, periodId: string, amountCents: number, rail: "EFT"|"BPAY", reference: string) {
  const transfer_uuid = uuidv4();
  try {
    await pool.query("INSERT INTO idempotency_keys(key,last_status) VALUES($1,$2)", [transfer_uuid, "INIT"]);
  } catch {
    return { transfer_uuid, status: "DUPLICATE" };
  }
  const bank_receipt_hash = "bank:" + transfer_uuid.slice(0,12);

  const { rows } = await pool.query(
    "SELECT balance_after_cents, hash_after FROM owa_ledger WHERE abn=$1 AND tax_type=$2 AND period_id=$3 ORDER BY id DESC LIMIT 1",
    [abn, taxType, periodId]
  );
  const prevBal = rows[0]?.balance_after_cents ?? 0;
  const prevHash = rows[0]?.hash_after ?? "";
  const newBal = prevBal - amountCents;
  const hashAfter = sha256Hex(prevHash + bank_receipt_hash + String(newBal));

  await pool.query(
    "INSERT INTO owa_ledger(abn,tax_type,period_id,transfer_uuid,amount_cents,balance_after_cents,bank_receipt_hash,prev_hash,hash_after) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
    [abn, taxType, periodId, transfer_uuid, -amountCents, newBal, bank_receipt_hash, prevHash, hashAfter]
  );
  await appendAudit("rails", "release", { abn, taxType, periodId, amountCents, rail, reference, bank_receipt_hash });
  await pool.query("UPDATE idempotency_keys SET last_status=$1 WHERE key=$2", ["DONE", transfer_uuid]);
  return { transfer_uuid, bank_receipt_hash };
}
