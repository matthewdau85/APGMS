import { createHash } from "crypto";
import type { Pool, PoolClient, QueryResult } from "pg";

export interface LedgerTail {
  balanceAfter: number;
  hashAfter: string;
}

type Queryable = Pick<Pool, "query"> | PoolClient | { query: (text: string, params?: any[]) => Promise<QueryResult<any>> };

let cachedLedgerColumns: Set<string> | null = null;

async function ensureLedgerColumns(db: Queryable): Promise<Set<string>> {
  if (cachedLedgerColumns) return cachedLedgerColumns;
  const { rows } = await db.query(
    `SELECT column_name
       FROM information_schema.columns
      WHERE table_name = 'owa_ledger'
        AND table_schema = ANY (current_schemas(false))`
  );
  cachedLedgerColumns = new Set(rows.map(r => String(r.column_name)));
  return cachedLedgerColumns;
}

export function computeLedgerHash(prevHash: string | null | undefined, bankReceiptHash: string | null | undefined, balanceAfter: number): string {
  const h = createHash("sha256");
  h.update(prevHash ?? "");
  h.update(bankReceiptHash ?? "");
  h.update(String(balanceAfter));
  return h.digest("hex");
}

export async function fetchLedgerTail(db: Queryable, abn: string, taxType: string, periodId: string): Promise<LedgerTail> {
  const { rows } = await db.query(
    `SELECT balance_after_cents, hash_after
       FROM owa_ledger
      WHERE abn = $1 AND tax_type = $2 AND period_id = $3
      ORDER BY id DESC
      LIMIT 1`,
    [abn, taxType, periodId]
  );
  if (!rows.length) return { balanceAfter: 0, hashAfter: "" };
  const row = rows[0];
  return {
    balanceAfter: Number(row.balance_after_cents ?? 0),
    hashAfter: String(row.hash_after ?? ""),
  };
}

export interface AppendLedgerParams {
  client: Queryable;
  abn: string;
  taxType: string;
  periodId: string;
  amountCents: number;
  transferUuid: string;
  bankReceiptHash: string | null;
  releaseUuid?: string | null;
  rptVerified?: boolean;
  bankReceiptId?: string | null;
  createdAt?: Date;
}

export interface AppendLedgerResult {
  id: number;
  balanceAfter: number;
  hashAfter: string;
  prevBalance: number;
  prevHash: string;
}

export async function appendLedgerEntry(params: AppendLedgerParams): Promise<AppendLedgerResult> {
  const { client, abn, taxType, periodId } = params;
  const tail = await fetchLedgerTail(client, abn, taxType, periodId);
  const prevBalance = tail.balanceAfter;
  const prevHash = tail.hashAfter;
  const newBalance = prevBalance + params.amountCents;
  const hashAfter = computeLedgerHash(prevHash, params.bankReceiptHash, newBalance);

  const cols = [
    "abn",
    "tax_type",
    "period_id",
    "transfer_uuid",
    "amount_cents",
    "balance_after_cents",
    "bank_receipt_hash",
    "prev_hash",
    "hash_after",
    "created_at",
  ];
  const values: any[] = [
    abn,
    taxType,
    periodId,
    params.transferUuid,
    params.amountCents,
    newBalance,
    params.bankReceiptHash,
    prevHash || null,
    hashAfter,
    params.createdAt ?? new Date(),
  ];

  const optionalColumns = await ensureLedgerColumns(client);
  const addOptional = (column: string, value: any) => {
    if (!optionalColumns.has(column)) return;
    cols.push(column);
    values.push(value);
  };

  addOptional("rpt_verified", params.rptVerified ?? false);
  addOptional("release_uuid", params.releaseUuid ?? null);
  addOptional("bank_receipt_id", params.bankReceiptId ?? null);

  const placeholders = cols.map((_, idx) => `$${idx + 1}`);
  const sql = `INSERT INTO owa_ledger(${cols.join(",")}) VALUES (${placeholders.join(",")}) RETURNING id, balance_after_cents, hash_after`;
  const { rows } = await client.query(sql, values);
  const inserted = rows[0];
  return {
    id: Number(inserted.id),
    balanceAfter: Number(inserted.balance_after_cents),
    hashAfter: String(inserted.hash_after ?? hashAfter),
    prevBalance,
    prevHash,
  };
}
