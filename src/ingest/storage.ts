import { Pool } from "pg";
import { AnyIngestPayload, IngestKind } from "./types";

const pool = new Pool();

interface StoreArgs {
  tenantId: string;
  taxType: string;
  periodId: string;
  sourceId: string;
  payload: AnyIngestPayload;
  rawPayload: any;
  signature?: string;
  hmacValid: boolean;
  endpoint: IngestKind;
}

export async function storeIngestEvent(args: StoreArgs): Promise<number> {
  const table = args.endpoint === "stp" ? "payroll_events" : "pos_events";
  const query = `insert into ${table} (tenant_id, tax_type, period_id, source_id, payload, raw_payload, signature, hmac_valid) values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`;
  const { rows } = await pool.query(query, [
    args.tenantId,
    args.taxType,
    args.periodId,
    args.sourceId,
    JSON.stringify(args.payload),
    JSON.stringify(args.rawPayload ?? {}),
    args.signature ?? null,
    args.hmacValid,
  ]);
  return rows[0]?.id as number;
}

export async function pushToDlq(endpoint: IngestKind, reason: string, payload: any, headers: Record<string, unknown> | null, tenantId?: string) {
  await pool.query(
    "insert into ingest_dlq(tenant_id, endpoint, reason, payload, headers) values ($1,$2,$3,$4,$5)",
    [tenantId ?? null, endpoint, reason, JSON.stringify(payload ?? {}), JSON.stringify(headers ?? {})]
  );
}

export async function removeDlqEntries(ids: number[]) {
  if (!ids.length) return;
  await pool.query("delete from ingest_dlq where id = any($1)", [ids]);
}

export async function fetchDlqEntries(ids: number[]) {
  if (!ids.length) return [] as any[];
  const { rows } = await pool.query("select * from ingest_dlq where id = any($1)", [ids]);
  return rows.map((row) => ({
    ...row,
    payload: typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload,
    headers: typeof row.headers === "string" ? JSON.parse(row.headers) : row.headers,
  }));
}
