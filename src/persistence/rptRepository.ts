import { query, pool, type Queryable } from "./db";

export interface RptTokenRow {
  id: number;
  abn: string;
  tax_type: string;
  period_id: string;
  payload: any;
  signature: string;
  payload_c14n: string;
  payload_sha256: string;
  status: string;
  created_at: Date;
}

export interface InsertRptArgs {
  abn: string;
  taxType: string;
  periodId: string;
  payload: any;
  signature: string;
  canonicalPayload: string;
  payloadSha256: string;
}

export async function insertRpt(
  args: InsertRptArgs,
  client: Queryable = pool,
): Promise<RptTokenRow> {
  const { rows } = await query<RptTokenRow>(
    `INSERT INTO rpt_tokens(abn,tax_type,period_id,payload,signature,payload_c14n,payload_sha256)
     VALUES($1,$2,$3,$4,$5,$6,$7)
     RETURNING *`,
    [
      args.abn,
      args.taxType,
      args.periodId,
      args.payload,
      args.signature,
      args.canonicalPayload,
      args.payloadSha256,
    ],
    client,
  );
  return rows[0];
}

export async function latestRpt(
  abn: string,
  taxType: string,
  periodId: string,
  client: Queryable = pool,
): Promise<RptTokenRow | undefined> {
  const { rows } = await query<RptTokenRow>(
    `SELECT * FROM rpt_tokens
      WHERE abn=$1 AND tax_type=$2 AND period_id=$3
      ORDER BY id DESC LIMIT 1`,
    [abn, taxType, periodId],
    client,
  );
  return rows[0];
}

