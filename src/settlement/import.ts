import express from "express";
import { Pool } from "pg";
import { parse } from "csv-parse/sync";

const pool = new Pool();

export interface SettlementRecord {
  provider_ref: string;
  rail: string;
  amount_cents: number;
  paid_at: string;
  abn: string;
  period_id: string;
}

export function toSettlementRecords(payload: any): SettlementRecord[] {
  if (!payload) return [];
  if (typeof payload === "string") {
    const text = payload.trim();
    if (!text) return [];
    const parsed = parse(text, { columns: true, trim: true });
    return parsed.map((row: any) => ({
      provider_ref: row.provider_ref,
      rail: row.rail,
      amount_cents: Number(row.amount_cents),
      paid_at: row.paid_at,
      abn: row.abn,
      period_id: row.period_id,
    }));
  }
  if (Array.isArray(payload)) {
    return payload.map((row: any) => ({
      provider_ref: row.provider_ref,
      rail: row.rail,
      amount_cents: Number(row.amount_cents),
      paid_at: row.paid_at,
      abn: row.abn,
      period_id: row.period_id,
    }));
  }
  if (payload?.records && Array.isArray(payload.records)) {
    return payload.records.map((row: any) => ({
      provider_ref: row.provider_ref,
      rail: row.rail,
      amount_cents: Number(row.amount_cents),
      paid_at: row.paid_at,
      abn: row.abn,
      period_id: row.period_id,
    }));
  }
  return [];
}

type Queryable = { query: (text: string, params?: any[]) => Promise<{ rows: any[]; rowCount: number }>; };

async function markVerified(client: Queryable, record: SettlementRecord) {
  const update = await client.query(
    `update settlements
       set rail=$2,
           amount_cents=$3,
           paid_at=$4,
           verified=true,
           verified_at=now()
     where provider_ref=$1
     returning *`,
    [
      record.provider_ref,
      record.rail?.toUpperCase?.() || record.rail,
      record.amount_cents,
      new Date(record.paid_at),
    ],
  );
  if (!update.rows.length) {
    throw new Error(`Unknown provider_ref ${record.provider_ref}`);
  }
  const row = update.rows[0];
  const pending = await client.query(
    `select count(*)::int as pending
       from settlements
      where abn=$1 and tax_type=$2 and period_id=$3 and verified=false`,
    [row.abn, row.tax_type, row.period_id],
  );
  if (pending.rows[0]?.pending === 0) {
    await client.query(
      `update periods set settlement_verified=true
        where abn=$1 and tax_type=$2 and period_id=$3`,
      [row.abn, row.tax_type, row.period_id],
    );
  }
  return row;
}

export async function applySettlementImport(
  client: Queryable,
  records: SettlementRecord[],
  rawPayload: string,
) {
  await client.query(`insert into settlement_imports(raw_payload) values ($1)`, [rawPayload]);
  const linked = [] as any[];
  for (const record of records) {
    const row = await markVerified(client, record);
    linked.push({
      provider_ref: row.provider_ref,
      abn: row.abn,
      tax_type: row.tax_type,
      period_id: row.period_id,
      verified: row.verified,
    });
  }
  return { linked: linked.length, records: linked };
}

export const settlementRouter = express.Router();

settlementRouter.use(express.text({ type: ["text/csv", "application/csv", "text/plain"] }));
settlementRouter.use(express.json());

settlementRouter.post("/import", async (req, res) => {
  const records = toSettlementRecords(req.body);
  if (!records.length) {
    return res.status(400).json({ error: "No settlement records" });
  }
  const rawPayload = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await applySettlementImport(client, records, rawPayload);
    await client.query("COMMIT");
    return res.json(result);
  } catch (err: any) {
    await client.query("ROLLBACK");
    return res.status(400).json({ error: err?.message || "Import failed" });
  } finally {
    client.release();
  }
});
