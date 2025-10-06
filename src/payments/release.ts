import { randomUUID } from "crypto";
import { Pool } from "pg";
import { BankingError, BankingPort, Rail } from "../rails/port";
import { sandboxBankingPort } from "../rails/adapters/sandbox";

export interface ReleaseInput {
  abn: string;
  taxType: string;
  periodId: string;
  rail: Rail;
  reference: string;
  amountCents: number;
  idempotencyKey: string;
}

export interface ReleaseDependencies {
  pool: Pool;
  banking: BankingPort;
  featureBanking?: boolean;
}

export interface ReleaseResult {
  providerRef: string;
  rail: Rail;
  amountCents: number;
  paidAt: string | null;
  receipt: unknown;
}

export class ReleaseError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ReleaseError";
    this.status = status;
  }
}

const defaultPool = new Pool();

export function getDefaultReleaseDependencies(): ReleaseDependencies {
  return {
    pool: defaultPool,
    banking: sandboxBankingPort,
    featureBanking: process.env.FEATURE_BANKING === "true" || process.env.FEATURE_BANKING === "1",
  };
}

function asDateISOString(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const asString = String(value);
  const date = new Date(asString);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export async function releaseToBank(
  input: ReleaseInput,
  deps: ReleaseDependencies = getDefaultReleaseDependencies()
): Promise<ReleaseResult> {
  if (!deps.featureBanking) {
    throw new ReleaseError(503, "BANKING_DISABLED");
  }
  const amount = Number(input.amountCents);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new ReleaseError(400, "INVALID_AMOUNT");
  }
  const idemKey = input.idempotencyKey?.trim();
  if (!idemKey) {
    throw new ReleaseError(400, "MISSING_IDEMPOTENCY_KEY");
  }
  const pool = deps.pool;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const existing = await client.query(
      `SELECT provider_ref, rail, amount_cents, paid_at, receipt_json
       FROM settlements WHERE idem_key=$1`,
      [idemKey]
    );
    if (existing.rowCount > 0) {
      await client.query("COMMIT");
      const row = existing.rows[0];
      return {
        providerRef: row.provider_ref,
        rail: (row.rail as Rail) ?? input.rail,
        amountCents: Number(row.amount_cents),
        paidAt: asDateISOString(row.paid_at),
        receipt: row.receipt_json ?? null,
      };
    }

    const { rows: destRows } = await client.query(
      `SELECT rail, reference, account_bsb, account_number, label
         FROM remittance_destinations
         WHERE abn=$1 AND rail=$2 AND reference=$3`,
      [input.abn, input.rail, input.reference]
    );
    if (destRows.length === 0) {
      throw new ReleaseError(400, "DESTINATION_NOT_ALLOWLISTED");
    }
    const destination = destRows[0];

    const { rows: balanceRows } = await client.query(
      `SELECT balance_after_cents
         FROM owa_ledger
         WHERE abn=$1 AND tax_type=$2 AND period_id=$3
         ORDER BY id DESC LIMIT 1`,
      [input.abn, input.taxType, input.periodId]
    );
    const previousBalance = Number(balanceRows[0]?.balance_after_cents ?? 0);
    if (previousBalance < amount) {
      throw new ReleaseError(400, "INSUFFICIENT_FUNDS");
    }
    const newBalance = previousBalance - amount;

    let response: ReleaseResult;
    try {
      if (input.rail === "EFT") {
        const eftResponse = await deps.banking.eftRelease({
          abn: input.abn,
          taxType: input.taxType,
          periodId: input.periodId,
          rail: "EFT",
          amountCents: amount,
          idempotencyKey: idemKey,
          destination: {
            bsb: String(destination.account_bsb || ""),
            accountNumber: String(destination.account_number || ""),
            accountName: destination.label || undefined,
          },
          metadata: { reference: input.reference },
        });
        response = {
          providerRef: eftResponse.providerRef,
          rail: "EFT",
          amountCents: amount,
          paidAt: asDateISOString(eftResponse.paidAt),
          receipt: eftResponse.receipt ?? null,
        };
      } else {
        const bpayResponse = await deps.banking.bpayRelease({
          abn: input.abn,
          taxType: input.taxType,
          periodId: input.periodId,
          rail: "BPAY",
          amountCents: amount,
          idempotencyKey: idemKey,
          destination: {
            billerCode: String(destination.reference || ""),
            crn: String(destination.account_number || destination.reference || ""),
          },
          metadata: { reference: input.reference },
        });
        response = {
          providerRef: bpayResponse.providerRef,
          rail: "BPAY",
          amountCents: amount,
          paidAt: asDateISOString(bpayResponse.paidAt),
          receipt: bpayResponse.receipt ?? null,
        };
      }
    } catch (err) {
      if (err instanceof BankingError) {
        throw new ReleaseError(err.status, err.message);
      }
      throw err;
    }

    let receipt = response.receipt;
    let paidAt = response.paidAt;
    if (!receipt) {
      try {
        const fetched = await deps.banking.fetchReceipt(response.providerRef);
        receipt = fetched.raw;
        paidAt = paidAt ?? asDateISOString(fetched.paidAt);
      } catch (err) {
        if (err instanceof BankingError && err.status !== 404) {
          throw new ReleaseError(err.status, err.message);
        }
      }
    }

    const transferUuid = randomUUID();
    await client.query(
      `INSERT INTO owa_ledger
         (abn, tax_type, period_id, transfer_uuid, amount_cents, balance_after_cents, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,now())`,
      [input.abn, input.taxType, input.periodId, transferUuid, -amount, newBalance]
    );

    await client.query(
      `INSERT INTO settlements
         (provider_ref, abn, period_id, rail, amount_cents, idem_key, paid_at, receipt_json, verified)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,false)`,
      [
        response.providerRef,
        input.abn,
        input.periodId,
        response.rail,
        amount,
        idemKey,
        paidAt ? new Date(paidAt) : null,
        receipt ?? null,
      ]
    );

    await client.query("COMMIT");
    return {
      providerRef: response.providerRef,
      rail: response.rail,
      amountCents: amount,
      paidAt,
      receipt,
    };
  } catch (err) {
    await client.query("ROLLBACK");
    if (err instanceof ReleaseError) {
      throw err;
    }
    throw err;
  } finally {
    client.release();
  }
}
