import { query, pool, type Queryable } from "./db";

export interface LedgerRow {
  id: number;
  abn: string;
  tax_type: string;
  period_id: string;
  transfer_uuid: string;
  amount_cents: string;
  balance_after_cents: string;
  bank_receipt_hash: string | null;
  prev_hash: string | null;
  hash_after: string | null;
  created_at: Date;
}

export interface AppendLedgerArgs {
  abn: string;
  taxType: string;
  periodId: string;
  amountCents: bigint;
  bankReceiptHash: string | null;
}

export async function appendLedger(
  args: AppendLedgerArgs,
  client: Queryable = pool,
): Promise<LedgerRow> {
  const { rows } = await query<{ id: number }>(
    `SELECT id FROM owa_append($1,$2,$3,$4,$5)`,
    [
      args.abn,
      args.taxType,
      args.periodId,
      args.amountCents.toString(),
      args.bankReceiptHash,
    ],
    client,
  );
  const insertedId = rows[0]?.id;
  if (!insertedId) {
    const latest = await latestLedger(args.abn, args.taxType, args.periodId, client);
    if (!latest) {
      throw new Error("LEDGER_APPEND_FAILED");
    }
    return latest;
  }
  const { rows: ledgerRows } = await query<LedgerRow>(
    `SELECT * FROM owa_ledger WHERE id=$1`,
    [insertedId],
    client,
  );
  const ledgerRow = ledgerRows[0];
  if (!ledgerRow) throw new Error("LEDGER_APPEND_FAILED");
  return ledgerRow;
}

export async function latestLedger(
  abn: string,
  taxType: string,
  periodId: string,
  client: Queryable = pool,
): Promise<LedgerRow | undefined> {
  const { rows } = await query<LedgerRow>(
    `SELECT * FROM owa_ledger
       WHERE abn=$1 AND tax_type=$2 AND period_id=$3
       ORDER BY id DESC LIMIT 1`,
    [abn, taxType, periodId],
    client,
  );
  return rows[0];
}

export async function sumLedgerCredits(
  abn: string,
  taxType: string,
  periodId: string,
  client: Queryable = pool,
): Promise<bigint> {
  const { rows } = await query<{ sum: string | null }>(
    `SELECT SUM(amount_cents) AS sum
       FROM owa_ledger
       WHERE abn=$1 AND tax_type=$2 AND period_id=$3`,
    [abn, taxType, periodId],
    client,
  );
  const sum = rows[0]?.sum;
  return BigInt(sum ?? "0");
}

export async function creditedLedgerTotal(
  abn: string,
  taxType: string,
  periodId: string,
  client: Queryable = pool,
): Promise<bigint> {
  const { rows } = await query<{ credited: string | null }>(
    `SELECT SUM(amount_cents) FILTER (WHERE amount_cents > 0) AS credited
       FROM owa_ledger
       WHERE abn=$1 AND tax_type=$2 AND period_id=$3`,
    [abn, taxType, periodId],
    client,
  );
  return BigInt(rows[0]?.credited ?? "0");
}

export async function recordLedgerRow(
  row: LedgerRow,
  client: Queryable = pool,
): Promise<void> {
  await query(
    `INSERT INTO owa_ledger(id,abn,tax_type,period_id,transfer_uuid,amount_cents,balance_after_cents,bank_receipt_hash,prev_hash,hash_after,created_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT (id) DO NOTHING`,
    [
      row.id,
      row.abn,
      row.tax_type,
      row.period_id,
      row.transfer_uuid,
      row.amount_cents,
      row.balance_after_cents,
      row.bank_receipt_hash,
      row.prev_hash,
      row.hash_after,
      row.created_at,
    ],
    client,
  );
}

