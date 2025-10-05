import type { PoolClient } from "pg";
import { ensureBankReconSchema } from "./schema.js";

export interface ReservePayoutParams {
  release_uuid: string;
  rpt_id: number;
  abn: string;
  taxType: string;
  periodId: string;
  amount_cents: number;
  reference: string;
  created_at?: Date;
}

export interface FinalizePayoutParams {
  release_uuid: string;
  ledger_entry_id: number;
  bank_receipt_id: string;
}

export async function reservePayoutRelease(client: PoolClient, params: ReservePayoutParams) {
  await ensureBankReconSchema(client);
  const createdAt = params.created_at ?? new Date();
  const sql = `
    INSERT INTO payout_releases (
      release_uuid, rpt_id, abn, tax_type, period_id,
      amount_cents, reference, created_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
    RETURNING release_uuid
  `;
  const vals = [
    params.release_uuid,
    params.rpt_id,
    params.abn,
    params.taxType,
    params.periodId,
    Math.round(params.amount_cents),
    params.reference,
    createdAt,
  ];
  return client.query(sql, vals);
}

export async function finalizePayoutRelease(client: PoolClient, params: FinalizePayoutParams) {
  await ensureBankReconSchema(client);
  const sql = `
    UPDATE payout_releases
      SET ledger_entry_id = $2,
          bank_receipt_id = $3
      WHERE release_uuid = $1
  `;
  await client.query(sql, [
    params.release_uuid,
    params.ledger_entry_id,
    params.bank_receipt_id,
  ]);
}

export async function markPayoutMatched(
  client: PoolClient,
  release_uuid: string,
  bank_txn_id: string,
  strategy: string
) {
  await ensureBankReconSchema(client);
  const sql = `
    UPDATE payout_releases
      SET matched_bank_txn_id = $2,
          match_strategy = $3,
          matched_at = now()
      WHERE release_uuid = $1
  `;
  await client.query(sql, [release_uuid, bank_txn_id, strategy]);
}
