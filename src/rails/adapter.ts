import { v4 as uuidv4 } from "uuid";
import { appendAudit } from "../audit/appendOnly";
import { sha256Hex } from "../crypto/merkle";
import { pool } from "../db/pool";
import { sql } from "../db/sql";

type Rail = "EFT" | "BPAY";

export async function resolveDestination(abn: string, rail: Rail, reference: string) {
  const query = sql`
    SELECT * FROM remittance_destinations
     WHERE abn=${abn} AND rail=${rail} AND reference=${reference}
  `;
  const { rows } = await pool.query(query.text, query.params);
  if (rows.length === 0) throw new Error("DEST_NOT_ALLOW_LISTED");
  return rows[0];
}

export async function releasePayment(
  abn: string,
  taxType: string,
  periodId: string,
  amountCents: number,
  rail: Rail,
  reference: string,
) {
  const transfer_uuid = uuidv4();
  const bank_receipt_hash = "bank:" + transfer_uuid.slice(0, 12);

  const ledgerQuery = sql`
    SELECT balance_after_cents, hash_after
      FROM owa_ledger
     WHERE abn=${abn} AND tax_type=${taxType} AND period_id=${periodId}
     ORDER BY id DESC LIMIT 1
  `;
  const { rows } = await pool.query(ledgerQuery.text, ledgerQuery.params);
  const prevBal = rows[0]?.balance_after_cents ?? 0;
  const prevHash = rows[0]?.hash_after ?? "";
  const newBal = prevBal - amountCents;
  const hashAfter = sha256Hex(prevHash + bank_receipt_hash + String(newBal));

  const insertLedger = sql`
    INSERT INTO owa_ledger(
      abn,tax_type,period_id,transfer_uuid,amount_cents,balance_after_cents,bank_receipt_hash,prev_hash,hash_after
    ) VALUES (
      ${abn},${taxType},${periodId},${transfer_uuid},${-amountCents},${newBal},${bank_receipt_hash},${prevHash},${hashAfter}
    ) RETURNING id
  `;
  await pool.query(insertLedger.text, insertLedger.params);
  await appendAudit("rails", "release", { abn, taxType, periodId, amountCents, rail, reference, bank_receipt_hash });
  return { transfer_uuid, bank_receipt_hash };
}
