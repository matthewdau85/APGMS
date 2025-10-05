import { Pool } from "pg";
import { v4 as uuidv4 } from "uuid";
import { appendAudit } from "../audit/appendOnly";
import { sha256Hex } from "../crypto/merkle";
import { sendEftOrBpay } from "../../apps/services/payments/src/bank/eftBpayAdapter";

const pool = new Pool();

type DestinationRow = {
  abn: string;
  rail: "EFT" | "BPAY";
  reference: string;
  account_bsb?: string | null;
  account_number?: string | null;
  label?: string | null;
};

type BankDestination = {
  bsb?: string;
  acct?: string;
  bpay_biller?: string;
  crn?: string;
};

let ensureLedgerColumnsPromise: Promise<void> | null = null;
async function ensureLedgerColumns() {
  if (!ensureLedgerColumnsPromise) {
    ensureLedgerColumnsPromise = pool
      .query(
        "alter table if exists owa_ledger add column if not exists idempotency_key text;" +
          "alter table if exists owa_ledger add column if not exists provider_receipt_id text"
      )
      .then(() => undefined);
  }
  return ensureLedgerColumnsPromise;
}

function toBankDestination(row: DestinationRow, rail: "EFT" | "BPAY"): BankDestination {
  if (rail === "EFT") {
    if (!row.account_bsb || !row.account_number) {
      throw new Error("EFT_DESTINATION_INCOMPLETE");
    }
    return { bsb: row.account_bsb, acct: row.account_number };
  }

  const referenceParts = row.reference.split(":");
  const possibleBiller = referenceParts.length > 1 ? referenceParts[0] : undefined;
  const crn = referenceParts.length > 1 ? referenceParts.slice(1).join(":") : row.reference;
  const configuredBiller = process.env.PAYMENTS_BPAY_BILLER || process.env.BPAY_BILLER;
  const bpay_biller = configuredBiller || row.account_bsb || possibleBiller;

  if (!bpay_biller) {
    throw new Error("BPAY_BILLER_UNAVAILABLE");
  }

  if (!crn) {
    throw new Error("BPAY_CRN_UNAVAILABLE");
  }

  return { bpay_biller, crn };
}

/** Allow-list enforcement and PRN/CRN lookup */
export async function resolveDestination(
  abn: string,
  rail: "EFT" | "BPAY",
  reference: string
): Promise<DestinationRow> {
  const { rows } = await pool.query<DestinationRow>(
    "select * from remittance_destinations where abn=$1 and rail=$2 and reference=$3",
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
  rail: "EFT" | "BPAY",
  reference: string
) {
  const destinationRow = await resolveDestination(abn, rail, reference);
  await ensureLedgerColumns();

  const idempotencyKey = sha256Hex([abn, taxType, periodId, rail, reference].join(":"));
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const existing = await client.query(
      "select last_status, response_hash from idempotency_keys where key=$1 for update",
      [idempotencyKey]
    );

    if (existing.rowCount > 0) {
      const row = existing.rows[0];
      if (row.last_status === "DONE" && row.response_hash) {
        await client.query("COMMIT");
        try {
          return JSON.parse(row.response_hash);
        } catch {
          return { status: "DONE", idempotency_key: idempotencyKey };
        }
      }
    } else {
      await client.query("insert into idempotency_keys(key,last_status) values($1,$2)", [
        idempotencyKey,
        "INIT"
      ]);
    }

    await client.query("update idempotency_keys set last_status=$2 where key=$1", [
      idempotencyKey,
      "IN_FLIGHT"
    ]);

    const transfer = await sendEftOrBpay({
      abn,
      taxType,
      periodId,
      amount_cents: amountCents,
      destination: toBankDestination(destinationRow, rail),
      idempotencyKey
    });

    const { rows: lastRows } = await client.query(
      "select balance_after_cents, hash_after from owa_ledger where abn=$1 and tax_type=$2 and period_id=$3 order by id desc limit 1",
      [abn, taxType, periodId]
    );

    const prevBal = lastRows[0]?.balance_after_cents ?? 0;
    const prevHash = lastRows[0]?.hash_after ?? "";
    const newBal = prevBal - amountCents;

    const providerReceiptId = transfer.provider_receipt_id || null;
    const bankReceiptHash =
      transfer.bank_receipt_hash ||
      sha256Hex(String(providerReceiptId || transfer.transfer_uuid || ""));
    const hashAfter = sha256Hex(prevHash + bankReceiptHash + String(newBal));
    const transferUuid = transfer.transfer_uuid || uuidv4();

    const { rows: inserted } = await client.query(
      `insert into owa_ledger(
        abn,tax_type,period_id,transfer_uuid,amount_cents,balance_after_cents,
        bank_receipt_hash,prev_hash,hash_after,idempotency_key,provider_receipt_id
      ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      returning transfer_uuid, bank_receipt_hash, provider_receipt_id`,
      [
        abn,
        taxType,
        periodId,
        transferUuid,
        -Math.abs(amountCents),
        newBal,
        bankReceiptHash,
        prevHash,
        hashAfter,
        idempotencyKey,
        providerReceiptId
      ]
    );

    const response = {
      transfer_uuid: inserted[0].transfer_uuid,
      bank_receipt_hash: inserted[0].bank_receipt_hash,
      provider_receipt_id: inserted[0].provider_receipt_id,
      idempotency_key: idempotencyKey
    };

    await client.query("update idempotency_keys set last_status=$2, response_hash=$3 where key=$1", [
      idempotencyKey,
      "DONE",
      JSON.stringify(response)
    ]);
    await client.query("COMMIT");

    await appendAudit("rails", "release", {
      abn,
      taxType,
      periodId,
      amountCents,
      rail,
      reference,
      idempotency_key: idempotencyKey,
      provider_receipt_id: providerReceiptId,
      bank_receipt_hash: response.bank_receipt_hash,
      transfer_uuid: response.transfer_uuid
    });

    return response;
  } catch (err) {
    await client.query("ROLLBACK");
    await client
      .query("update idempotency_keys set last_status=$2 where key=$1", [idempotencyKey, "ERROR"])
      .catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
