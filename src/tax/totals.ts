import type { PoolClient } from "pg";
import { pool } from "../db/pool";

export interface TaxTotalsRecord {
  totals: Record<string, unknown>;
  rates_version: string;
  labels: Record<string, string>;
}

type Queryable = Pick<PoolClient, "query">;

export async function getTaxTotals(
  abn: string,
  taxType: "PAYGW" | "GST",
  periodId: string,
  client?: Queryable
): Promise<TaxTotalsRecord> {
  const runner = client ?? pool;
  const { rows } = await runner.query<TaxTotalsRecord>(
    `SELECT totals, rates_version, labels
       FROM tax_period_totals
      WHERE abn=$1 AND tax_type=$2 AND period_id=$3`,
    [abn, taxType, periodId]
  );
  if (!rows.length) {
    throw new Error("TAX_TOTALS_NOT_FOUND");
  }
  const row = rows[0];
  return {
    totals: row.totals ?? {},
    rates_version: row.rates_version,
    labels: row.labels ?? {},
  };
}
