import type { PoolClient } from "pg";
import { appendLedger, creditedLedgerTotal, latestLedger } from "../persistence/ledgerRepository";
import { withTransaction } from "../persistence/db";

export interface LedgerAppendArgs {
  abn: string;
  taxType: string;
  periodId: string;
  amountCents: bigint;
  bankReceiptHash: string | null;
}

export async function appendEntry(args: LedgerAppendArgs, client?: PoolClient) {
  if (client) {
    return appendLedger(args, client);
  }
  return withTransaction(async (txClient: PoolClient) => {
    const row = await appendLedger(args, txClient);
    return row;
  });
}

export async function latestBalance(abn: string, taxType: string, periodId: string) {
  const row = await latestLedger(abn, taxType, periodId);
  return row ? BigInt(row.balance_after_cents ?? "0") : BigInt(0);
}

export async function creditedTotal(abn: string, taxType: string, periodId: string) {
  return creditedLedgerTotal(abn, taxType, periodId);
}

