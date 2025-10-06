import { Pool } from "pg";
import { v4 as uuidv4 } from "uuid";
import { appendAudit } from "../audit/appendOnly";
import { sha256Hex } from "../crypto/merkle";
const pool = new Pool();

/** Allow-list enforcement and PRN/CRN lookup */
export async function resolveDestination(abn: string, rail: "EFT"|"BPAY", reference: string) {
  const { rows } = await pool.query(
    "select * from remittance_destinations where abn= and rail= and reference=",
    [abn, rail, reference]
  );
  if (rows.length === 0) throw new Error("DEST_NOT_ALLOW_LISTED");
  return rows[0];
}

/** Idempotent release with a stable transfer_uuid (simulate bank release) */
export async function releasePayment(
  abn: string,
  taxType: string,
  periodId: string,
  amountCents: number,
  rail: "EFT"|"BPAY",
  reference: string,
  opts?: { idempotencyKey?: string }
) {
  const provider_ref = opts?.idempotencyKey || uuidv4();
  const transfer_uuid = provider_ref;
  try {
    await pool.query("insert into idempotency_keys(key,last_status) values(,)", [transfer_uuid, "INIT"]);
  } catch {
    if (!opts?.idempotencyKey) {
      return { provider_ref, status: "DUPLICATE" };
    }
  }
  const bank_receipt_hash = "bank:" + sha256Hex(provider_ref).slice(0, 24);

  const { rows } = await pool.query(
    "select balance_after_cents, hash_after from owa_ledger where abn= and tax_type= and period_id= order by id desc limit 1",
    [abn, taxType, periodId]);
  const prevBal = rows[0]?.balance_after_cents ?? 0;
  const prevHash = rows[0]?.hash_after ?? "";
  const newBal = prevBal - amountCents;
  const hashAfter = sha256Hex(prevHash + bank_receipt_hash + String(newBal));

  await pool.query(
    "insert into owa_ledger(abn,tax_type,period_id,transfer_uuid,amount_cents,balance_after_cents,bank_receipt_hash,prev_hash,hash_after) values (,,,,,,,,)",
    [abn, taxType, periodId, transfer_uuid, -amountCents, newBal, bank_receipt_hash, prevHash, hashAfter]
  );
  await appendAudit("rails", "release", {
    abn,
    taxType,
    periodId,
    amountCents,
    rail,
    reference,
    provider_ref,
    bank_receipt_hash
  });
  await pool.query("update idempotency_keys set last_status= where key=", [transfer_uuid, "DONE"]);
  return { provider_ref, bank_receipt_hash };
}
