import { Request, Response } from "express";
import { parse } from "csv-parse/sync";
import { Pool } from "pg";
import { ensureSettlementSchema } from "./schema";
import { appendAudit } from "../audit/appendOnly";

const pool = new Pool();

export interface SettlementImportRow {
  provider_ref: string;
  rail: string;
  amount_cents: number;
  paid_at: string;
  abn: string;
  period_id: string;
}

function isRowLike(value: any): value is Partial<SettlementImportRow> {
  return value && typeof value === "object" && "provider_ref" in value;
}

function normaliseRow(row: Partial<SettlementImportRow>): SettlementImportRow {
  const provider_ref = String(row.provider_ref || "").trim();
  if (!provider_ref) throw new Error("provider_ref required");
  const rail = String(row.rail || "").trim();
  const amount_cents = Number(row.amount_cents);
  const paid_at = row.paid_at ? new Date(row.paid_at).toISOString() : new Date().toISOString();
  const abn = String(row.abn || "").trim();
  const period_id = String(row.period_id || "").trim();
  if (!abn || !period_id) throw new Error("abn/period_id required");
  if (!Number.isFinite(amount_cents)) throw new Error("amount_cents invalid");
  return { provider_ref, rail, amount_cents, paid_at, abn, period_id };
}

export function parseImportPayload(body: any): SettlementImportRow[] {
  if (!body) return [];
  if (typeof body === "string") {
    const records = parse(body, { columns: true, skip_empty_lines: true });
    return records.map((r: any) => normaliseRow(r));
  }
  if (Array.isArray(body)) {
    return body.filter(isRowLike).map((r) => normaliseRow(r));
  }
  if (typeof body === "object" && typeof body.csv === "string") {
    return parseImportPayload(body.csv);
  }
  if (isRowLike(body)) {
    return [normaliseRow(body)];
  }
  return [];
}

export async function importSettlementRows(rows: SettlementImportRow[], source = "sim-rail") {
  if (!rows.length) return 0;
  await ensureSettlementSchema();
  const client = await pool.connect();
  let linked = 0;
  const touchedPeriods: { abn: string; tax_type: string; period_id: string }[] = [];
  try {
    await client.query("BEGIN");
    const { rows: ins } = await client.query(
      "insert into recon_imports(source,payload) values($1,$2) returning id",
      [source, JSON.stringify(rows)]
    );
    const importId = ins[0].id;

    for (const row of rows) {
      const settlement = await client.query(
        `update settlements
           set recon_import_id=$1,
               reconciled_at=now()
         where provider_ref=$2
         returning abn, tax_type, period_id`,
        [importId, row.provider_ref]
      );
      if (settlement.rowCount === 0) continue;
      linked += 1;
      const { abn, tax_type, period_id } = settlement.rows[0];
      touchedPeriods.push({ abn, tax_type, period_id });
      await client.query(
        "update periods set settlement_verified=true where abn=$1 and tax_type=$2 and period_id=$3",
        [abn, tax_type, period_id]
      );
      await client.query(
        "insert into period_approvals(abn,tax_type,period_id,approved_by,role) values($1,$2,$3,$4,$5) on conflict do nothing",
        [abn, tax_type, period_id, "system", "reconciliation"]
      );
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  if (linked > 0) {
    await appendAudit("settlement", "import", {
      rows: linked,
      periods: touchedPeriods,
    });
  }
  return linked;
}

export async function settlementImportHandler(req: Request, res: Response) {
  try {
    const rows = parseImportPayload(req.body);
    const imported = await importSettlementRows(rows, "api");
    res.json({ imported });
  } catch (error: any) {
    res.status(400).json({ error: String(error?.message || error) });
  }
}
