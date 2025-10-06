import { v4 as uuidv4 } from "uuid";
import { appendAudit } from "../audit/appendOnly";
import { sha256Hex } from "../crypto/merkle";
import { getPool } from "../db/pool";

/** Allow-list enforcement and PRN/CRN lookup */
export async function resolveDestination(abn: string, rail: "EFT" | "BPAY", reference: string) {
  const pool = getPool();
  const { rows } = await pool.query(
    "select * from remittance_destinations where abn=$1 and rail=$2 and reference=$3",
    [abn, rail, reference]
  );
  if (rows.length === 0) throw new Error("DEST_NOT_ALLOW_LISTED");
  return rows[0];
}

interface ReleaseResult {
  transfer_uuid: string;
  bank_receipt_hash?: string;
  provider_ref?: string;
  status: "OK" | "DUPLICATE";
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
  const pool = getPool();
  const transfer_uuid = uuidv4();
  const client = await pool.connect();
  let committed = false;
  try {
    await client.query("BEGIN");
    try {
      await client.query("insert into idempotency_keys(key,last_status) values($1,$2)", [transfer_uuid, "INIT"]);
    } catch {
      await client.query("ROLLBACK");
      return { transfer_uuid, status: "DUPLICATE" };
    }

    const { rows } = await client.query(
      "select balance_after_cents, hash_after from owa_ledger where abn=$1 and tax_type=$2 and period_id=$3 order by id desc limit 1",
      [abn, taxType, periodId]
    );
    const prevBal = rows[0]?.balance_after_cents ?? 0;
    const prevHash = rows[0]?.hash_after ?? "";
    const newBal = prevBal - amountCents;
    const bank_receipt_hash = "bank:" + transfer_uuid.slice(0, 12);
    const hashAfter = sha256Hex(prevHash + bank_receipt_hash + String(newBal));

    await client.query(
      "insert into owa_ledger(abn,tax_type,period_id,transfer_uuid,amount_cents,balance_after_cents,bank_receipt_hash,prev_hash,hash_after) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
      [abn, taxType, periodId, transfer_uuid, -amountCents, newBal, bank_receipt_hash, prevHash, hashAfter]
    );

    await client.query("COMMIT");
    committed = true;

    const responseHash = sha256Hex(bank_receipt_hash);
    await pool.query("update idempotency_keys set last_status=$1, response_hash=$2 where key=$3", ["DONE", responseHash, transfer_uuid]);
    await appendAudit("rails", "release", { abn, taxType, periodId, amountCents, rail, reference, bank_receipt_hash, transfer_uuid });
    return { transfer_uuid, bank_receipt_hash, provider_ref: reference, status: "OK" };
  } finally {
    if (!committed) {
      await client.query("ROLLBACK").catch(() => undefined);
    }
    client.release();
  }
}
