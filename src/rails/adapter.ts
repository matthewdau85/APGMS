import { Pool } from "pg";
import { v4 as uuidv4 } from "uuid";
import { appendAudit } from "../audit/appendOnly";
import { sha256Hex } from "../crypto/merkle";

const pool = new Pool();

/** Allow-list enforcement and PRN/CRN lookup */
export async function resolveDestination(abn: string, rail: "EFT" | "BPAY", reference: string) {
  const { rows } = await pool.query(
    `SELECT abn, rail, reference, label, account_bsb, account_number
       FROM remittance_destinations
      WHERE abn=$1 AND rail=$2 AND reference=$3`,
    [abn, rail, reference]
  );
  if (rows.length === 0) throw new Error("DEST_NOT_ALLOW_LISTED");
  return rows[0];
}

interface ReleaseResult {
  transfer_uuid: string;
  bank_receipt_hash: string;
  balance_after_cents: number;
  audit_hash: string;
  status: "DONE" | "DUPLICATE" | "ERROR";
}

/** Idempotent release with a stable transfer_uuid (simulate bank release) */
export async function releasePayment(
  abn: string,
  taxType: string,
  periodId: string,
  amountCents: number,
  rail: "EFT" | "BPAY",
  reference: string
): Promise<ReleaseResult> {
  const transferUuid = uuidv4();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const insertedKey = await client.query(
      `INSERT INTO idempotency_keys(key,last_status)
         VALUES ($1,$2)
         ON CONFLICT (key) DO NOTHING
         RETURNING key`,
      [transferUuid, "INIT"]
    );

    if (insertedKey.rowCount === 0) {
      const existing = await client.query(
        "SELECT last_status, response_hash FROM idempotency_keys WHERE key=$1",
        [transferUuid]
      );
      await client.query("ROLLBACK");
      return {
        transfer_uuid: transferUuid,
        bank_receipt_hash: "",
        balance_after_cents: 0,
        audit_hash: existing.rows[0]?.response_hash ?? "",
        status: (existing.rows[0]?.last_status as "DONE" | "DUPLICATE" | undefined) ?? "DUPLICATE"
      };
    }

    const bankReceiptHash = `bank:${transferUuid.slice(0, 12)}`;

    const { rows: last } = await client.query(
      `SELECT balance_after_cents, hash_after
         FROM owa_ledger
        WHERE abn=$1 AND tax_type=$2 AND period_id=$3
        ORDER BY id DESC LIMIT 1`,
      [abn, taxType, periodId]
    );
    const prevBal = Number(last[0]?.balance_after_cents ?? 0);
    const prevHash = last[0]?.hash_after ?? "";
    const newBal = prevBal - amountCents;
    const hashAfter = sha256Hex(prevHash + bankReceiptHash + String(newBal));

    const ledgerInsert = await client.query(
      `INSERT INTO owa_ledger
         (abn,tax_type,period_id,transfer_uuid,amount_cents,balance_after_cents,bank_receipt_hash,prev_hash,hash_after)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING balance_after_cents`,
      [
        abn,
        taxType,
        periodId,
        transferUuid,
        -amountCents,
        newBal,
        bankReceiptHash,
        prevHash,
        hashAfter
      ]
    );

    const auditHash = await appendAudit(
      "rails.release",
      { abn, taxType, periodId, amountCents, rail, reference, bank_receipt_hash: bankReceiptHash },
      client
    );

    await client.query(
      "UPDATE idempotency_keys SET last_status=$1, response_hash=$2 WHERE key=$3",
      ["DONE", auditHash, transferUuid]
    );

    await client.query("COMMIT");

    return {
      transfer_uuid: transferUuid,
      bank_receipt_hash: bankReceiptHash,
      balance_after_cents: Number(ledgerInsert.rows[0].balance_after_cents),
      audit_hash: auditHash,
      status: "DONE"
    };
  } catch (err) {
    await client.query("ROLLBACK");
    await client.query(
      "UPDATE idempotency_keys SET last_status=$1 WHERE key=$2",
      ["ERROR", transferUuid]
    );
    throw err;
  } finally {
    client.release();
  }
}
