import type { PoolClient } from "pg";
import type { BankingChannel } from "./index.js";

export type ReceiptRecord = {
  id: number;
  providerRef: string;
};

type InsertParams = {
  client: PoolClient;
  abn: string;
  taxType: string;
  periodId: string;
  channel: BankingChannel;
  providerRef: string;
  dryRun: boolean;
  shadowOnly: boolean;
};

export async function insertBankReceipt(params: InsertParams): Promise<ReceiptRecord> {
  const { client, abn, taxType, periodId, channel, providerRef, dryRun, shadowOnly } = params;
  const { rows } = await client.query<{ id: number; provider_ref: string }>(
    `INSERT INTO bank_receipts (abn, tax_type, period_id, channel, provider_ref, dry_run, shadow_only)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING id, provider_ref`,
    [abn, taxType, periodId, channel, providerRef, dryRun, shadowOnly]
  );
  return { id: rows[0].id, providerRef: rows[0].provider_ref };
}
