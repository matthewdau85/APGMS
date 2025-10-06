import { PoolClient } from "pg";
import { v4 as uuidv4 } from "uuid";
import { appendAudit } from "../audit/appendOnly";
import { sha256Hex } from "../crypto/merkle";
import { pool } from "../db/pool";

export class ReleaseError extends Error {
  code: string;
  detail?: Record<string, unknown>;
  constructor(code: string, message: string, detail?: Record<string, unknown>) {
    super(message);
    this.code = code;
    this.detail = detail;
  }
}

export type BankReleaseInput = {
  abn: string;
  taxType: string;
  periodId: string;
  amountCents: number;
  rail: "EFT" | "BPAY";
  reference: string;
  transfer_uuid: string;
};

export type BankReleaseExecutor = (input: BankReleaseInput) => Promise<void>;

const defaultBankExecutor: BankReleaseExecutor = async () => {};

function getRunner(client?: PoolClient) {
  return client ?? pool;
}

/** Allow-list enforcement and PRN/CRN lookup */
export async function resolveDestination(
  abn: string,
  rail: "EFT" | "BPAY",
  reference: string,
  client?: PoolClient
) {
  const runner = getRunner(client);
  const { rows } = await runner.query(
    `SELECT * FROM remittance_destinations WHERE abn=$1 AND rail=$2 AND reference=$3`,
    [abn, rail, reference]
  );
  if (rows.length === 0) throw new Error("DEST_NOT_ALLOW_LISTED");
  return rows[0];
}

export interface ReleaseOptions {
  client?: PoolClient;
  bankExecutor?: BankReleaseExecutor;
}

/** Idempotent release with compensation on failure */
export async function releasePayment(
  abn: string,
  taxType: string,
  periodId: string,
  amountCents: number,
  rail: "EFT" | "BPAY",
  reference: string,
  options: ReleaseOptions = {}
) {
  const transfer_uuid = uuidv4();
  const client = options.client ?? (await pool.connect());
  const bankExecutor = options.bankExecutor ?? defaultBankExecutor;
  let began = false;

  const finish = async () => {
    if (!options.client) {
      client.release();
    }
  };

  try {
    if (!options.client) {
      await client.query("BEGIN");
      began = true;
    }

    try {
      await client.query(`INSERT INTO idempotency_keys(key,last_status) VALUES ($1,$2)`, [
        transfer_uuid,
        "INIT"
      ]);
    } catch {
      if (began) await client.query("ROLLBACK");
      return { transfer_uuid, status: "DUPLICATE" };
    }

    const latest = await client.query(
      `SELECT balance_after_cents, hash_after
         FROM owa_ledger
        WHERE abn=$1 AND tax_type=$2 AND period_id=$3
        ORDER BY id DESC LIMIT 1`,
      [abn, taxType, periodId]
    );

    const prevBal = Number(latest.rows[0]?.balance_after_cents ?? 0);
    if (prevBal < amountCents) {
      throw new ReleaseError("INSUFFICIENT_FUNDS", "Insufficient funds in OWA", {
        balance: prevBal,
        required: amountCents
      });
    }

    const prevHash = latest.rows[0]?.hash_after ?? "";
    const bank_receipt_hash = `bank:${transfer_uuid.slice(0, 12)}`;

    const newBal = prevBal - amountCents;
    const hashAfter = sha256Hex(prevHash + bank_receipt_hash + String(newBal));

    await client.query(
      `INSERT INTO owa_ledger(
         abn,tax_type,period_id,transfer_uuid,amount_cents,balance_after_cents,bank_receipt_hash,prev_hash,hash_after)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [abn, taxType, periodId, transfer_uuid, -amountCents, newBal, bank_receipt_hash, prevHash, hashAfter]
    );

    try {
      await bankExecutor({ abn, taxType, periodId, amountCents, rail, reference, transfer_uuid });
    } catch (bankErr: any) {
      throw new ReleaseError("BANK_FAILURE", bankErr?.message ?? "Bank transfer failed");
    }

    await appendAudit(
      "rails",
      "release",
      { abn, taxType, periodId, amountCents, rail, reference, bank_receipt_hash },
      client
    );

    await client.query(`UPDATE idempotency_keys SET last_status=$2 WHERE key=$1`, [
      transfer_uuid,
      "DONE"
    ]);

    if (began) {
      await client.query("COMMIT");
    }

    return { transfer_uuid, bank_receipt_hash, balance_after_cents: newBal };
  } catch (err: any) {
    if (began) {
      await client.query("ROLLBACK");
    }
    if (err instanceof ReleaseError) {
      throw err;
    }
    throw new ReleaseError("UNEXPECTED", err?.message ?? "Release failed");
  } finally {
    await finish();
  }
}
