import crypto from "crypto";
import { appendAudit } from "../audit/appendOnly";
import { query, withTransaction } from "../persistence/db";
import { appendEntry } from "../services/ledgerService";

/** Allow-list enforcement and PRN/CRN lookup */
export async function resolveDestination(abn: string, rail: "EFT" | "BPAY", reference: string) {
  const { rows } = await query(
    "SELECT * FROM remittance_destinations WHERE abn=$1 AND rail=$2 AND reference=$3",
    [abn, rail, reference],
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
  rail: "EFT" | "BPAY",
  reference: string,
) {
  const transfer_uuid = crypto.randomUUID();
  const bank_receipt_hash = `bank:${transfer_uuid.slice(0, 12)}`;
  return withTransaction(async (client) => {
    try {
      await client.query("INSERT INTO idempotency_keys(key,last_status) VALUES($1,$2)", [transfer_uuid, "INIT"]);
    } catch {
      return { transfer_uuid, status: "DUPLICATE" };
    }

    const ledgerRow = await appendEntry(
      {
        abn,
        taxType,
        periodId,
        amountCents: BigInt(-amountCents),
        bankReceiptHash: bank_receipt_hash,
      },
      client,
    );

    const balanceAfter = ledgerRow.balance_after_cents;
    const hashAfter = ledgerRow.hash_after;

    await appendAudit("rails", "release", {
      abn,
      taxType,
      periodId,
      amountCents,
      rail,
      reference,
      transfer_uuid,
      bank_receipt_hash,
      hashAfter,
    }, client);
    await client.query(
      "UPDATE idempotency_keys SET last_status=$1, response_hash=$2 WHERE key=$3",
      ["DONE", hashAfter, transfer_uuid],
    );
    return { transfer_uuid, bank_receipt_hash, balance_after_cents: balanceAfter };
  });
}
