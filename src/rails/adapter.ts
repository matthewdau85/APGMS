import { v4 as uuidv4 } from "uuid";

import { appendAudit } from "../audit/appendOnly";
import { pool } from "../db/pool";
import { sha256Hex } from "../crypto/merkle";

export async function resolveDestination(abn: string, rail: "EFT" | "BPAY", reference: string) {
  const { rows } = await pool.query(
    "SELECT * FROM remittance_destinations WHERE abn=$1 AND rail=$2 AND reference=$3",
    [abn, rail, reference]
  );
  if (rows.length === 0) throw new Error("DEST_NOT_ALLOW_LISTED");
  return rows[0];
}

interface ReleaseParams {
  abn: string;
  taxType: string;
  periodId: string;
  amountCents: number;
  rail: "EFT" | "BPAY";
  reference: string;
  actor: string;
  requestId?: string;
}

export async function releasePayment(params: ReleaseParams) {
  const {
    abn,
    taxType,
    periodId,
    amountCents,
    rail,
    reference,
    actor,
    requestId,
  } = params;

  const transferUuid = uuidv4();
  try {
    await pool.query("INSERT INTO idempotency_keys(key,last_status) VALUES($1,$2)", [
      transferUuid,
      "INIT",
    ]);
  } catch {
    return { transfer_uuid: transferUuid, status: "DUPLICATE" };
  }
  const bankReceiptHash = "bank:" + transferUuid.slice(0, 12);

  const { rows } = await pool.query(
    `SELECT balance_after_cents, hash_after FROM owa_ledger
       WHERE abn=$1 AND tax_type=$2 AND period_id=$3
       ORDER BY id DESC LIMIT 1`,
    [abn, taxType, periodId]
  );
  const prevBal = Number(rows[0]?.balance_after_cents ?? 0);
  const prevHash = rows[0]?.hash_after ?? "";
  const newBal = prevBal - amountCents;
  const hashAfter = sha256Hex(prevHash + bankReceiptHash + String(newBal));

  await pool.query(
    `INSERT INTO owa_ledger(abn, tax_type, period_id, transfer_uuid, amount_cents,
       balance_after_cents, bank_receipt_hash, prev_hash, hash_after)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      abn,
      taxType,
      periodId,
      transferUuid,
      -amountCents,
      newBal,
      bankReceiptHash,
      prevHash,
      hashAfter,
    ]
  );

  await appendAudit(actor, "receipt_persisted", {
    abn,
    taxType,
    periodId,
    amountCents,
    rail,
    reference,
    bankReceiptHash,
    requestId,
  });

  await pool.query("UPDATE idempotency_keys SET last_status=$1 WHERE key=$2", [
    "DONE",
    transferUuid,
  ]);
  return { transfer_uuid: transferUuid, bank_receipt_hash: bankReceiptHash };
}
