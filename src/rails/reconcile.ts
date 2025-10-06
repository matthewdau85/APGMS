import { Router } from "express";
import { parse as parseCsv } from "csv-parse/sync";
import { Pool } from "pg";

const pool = new Pool();

export interface SettlementImportRow {
  provider_ref: string;
  abn?: string;
  period_id?: string;
  rail?: string;
  amount_cents?: number | string;
  paid_at?: string;
  receipt?: unknown;
}

export async function importSettlementRows(rows: SettlementImportRow[], clientPool: Pool = pool) {
  if (!Array.isArray(rows)) {
    throw new Error("ROWS_MUST_BE_ARRAY");
  }
  const client = await clientPool.connect();
  const imported: string[] = [];
  try {
    await client.query("BEGIN");
    for (const row of rows) {
      const providerRef = String(row.provider_ref || "").trim();
      if (!providerRef) {
        continue;
      }
      const periodId = row.period_id ? String(row.period_id).trim() : null;
      const abn = row.abn ? String(row.abn).trim() : null;
      const rail = row.rail ? String(row.rail).toUpperCase() : null;
      const amount = row.amount_cents !== undefined && row.amount_cents !== null
        ? Number(row.amount_cents)
        : null;
      const paidAtIso = row.paid_at ? new Date(row.paid_at).toISOString() : null;
      let receiptJson: unknown = row.receipt;
      if (typeof receiptJson === "string" && receiptJson.trim().startsWith("{")) {
        try {
          receiptJson = JSON.parse(receiptJson);
        } catch {
          // keep as raw string
        }
      }
      const update = await client.query(
        `UPDATE settlements
            SET paid_at = COALESCE($2, paid_at),
                receipt_json = COALESCE($3, receipt_json),
                amount_cents = COALESCE($4, amount_cents),
                rail = COALESCE($5, rail),
                period_id = COALESCE($6, period_id),
                abn = COALESCE($7, abn),
                verified = TRUE
          WHERE provider_ref=$1
          RETURNING provider_ref`,
        [providerRef, paidAtIso ? new Date(paidAtIso) : null, receiptJson ?? null, amount, rail, periodId, abn]
      );
      if (update.rowCount === 0) {
        await client.query(
          `INSERT INTO settlements
             (provider_ref, abn, period_id, rail, amount_cents, idem_key, paid_at, receipt_json, verified)
           VALUES ($1,$2,$3,$4,$5,NULL,$6,$7,TRUE)
           ON CONFLICT (provider_ref)
           DO UPDATE SET
             abn = COALESCE(EXCLUDED.abn, settlements.abn),
             period_id = COALESCE(EXCLUDED.period_id, settlements.period_id),
             rail = COALESCE(EXCLUDED.rail, settlements.rail),
             amount_cents = COALESCE(EXCLUDED.amount_cents, settlements.amount_cents),
             paid_at = COALESCE(EXCLUDED.paid_at, settlements.paid_at),
             receipt_json = COALESCE(EXCLUDED.receipt_json, settlements.receipt_json),
             verified = TRUE`,
          [providerRef, abn, periodId, rail, amount, paidAtIso ? new Date(paidAtIso) : null, receiptJson ?? null]
        );
      }
      imported.push(providerRef);
    }
    await client.query("COMMIT");
    return { imported };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

function normaliseBody(body: any): SettlementImportRow[] {
  if (!body) return [];
  if (Array.isArray(body)) {
    return body as SettlementImportRow[];
  }
  if (typeof body === "object") {
    if (Array.isArray(body.entries)) {
      return body.entries as SettlementImportRow[];
    }
    if (typeof body.csv === "string") {
      return parseCsv(body.csv, { columns: true, skip_empty_lines: true }) as SettlementImportRow[];
    }
  }
  if (typeof body === "string") {
    return parseCsv(body, { columns: true, skip_empty_lines: true }) as SettlementImportRow[];
  }
  return [];
}

export const railsRouter = Router();

railsRouter.post("/rails/reconcile/import", async (req, res) => {
  try {
    const rows = normaliseBody(req.body);
    const result = await importSettlementRows(rows);
    return res.json({ imported: result.imported.length, provider_refs: result.imported });
  } catch (err) {
    return res.status(400).json({ error: "IMPORT_FAILED", detail: String((err as any)?.message || err) });
  }
});
