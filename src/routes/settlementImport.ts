import { Request, Response } from "express";
import { parse } from "csv-parse/sync";
import { Pool } from "pg";

const pool = new Pool();

let ensured = false;
async function ensureSettlementTable() {
  if (ensured) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS settlements (
      id              BIGSERIAL PRIMARY KEY,
      provider_ref    TEXT UNIQUE NOT NULL,
      rail            TEXT NOT NULL,
      amount_cents    BIGINT NOT NULL,
      paid_at         TIMESTAMPTZ,
      abn             TEXT,
      tax_type        TEXT,
      period_id       TEXT,
      idempotency_key TEXT,
      transfer_uuid   UUID,
      recon_payload   JSONB DEFAULT '{}'::jsonb,
      evidence_uri    TEXT,
      evidence_bundle BIGINT,
      created_at      TIMESTAMPTZ DEFAULT NOW(),
      updated_at      TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS ux_settlements_idem_key
      ON settlements(idempotency_key)
      WHERE idempotency_key IS NOT NULL;
  `);
  ensured = true;
}

type SettlementImportRow = {
  provider_ref: string;
  amount_cents: number;
  paid_at: string;
  rail?: string;
  evidence_uri?: string;
};

function parseCsv(text: string): SettlementImportRow[] {
  const rows = parse(text, { columns: true, skip_empty_lines: true });
  return rows.map((row: any) => ({
    provider_ref: String(row.provider_ref ?? row.providerRef ?? "").trim(),
    amount_cents: Number(row.amount_cents ?? row.amountCents ?? 0),
    paid_at: String(row.paid_at ?? row.paidAt ?? ""),
    rail: row.rail ? String(row.rail).toUpperCase() : undefined,
    evidence_uri: row.evidence_uri ?? row.evidenceUri ?? undefined,
  }));
}

function parseJson(body: any): SettlementImportRow[] {
  if (!body) return [];
  const rows = Array.isArray(body) ? body : body.rows ?? body.settlements ?? [];
  return rows.map((row: any) => ({
    provider_ref: String(row.provider_ref ?? row.providerRef ?? "").trim(),
    amount_cents: Number(row.amount_cents ?? row.amountCents ?? 0),
    paid_at: String(row.paid_at ?? row.paidAt ?? ""),
    rail: row.rail ? String(row.rail).toUpperCase() : undefined,
    evidence_uri: row.evidence_uri ?? row.evidenceUri ?? undefined,
  }));
}

function validateRow(row: SettlementImportRow) {
  if (!row.provider_ref) throw new Error("provider_ref required");
  if (!Number.isFinite(row.amount_cents)) throw new Error("amount_cents must be numeric");
  if (!row.paid_at) throw new Error("paid_at required");
  const ts = new Date(row.paid_at);
  if (Number.isNaN(ts.getTime())) throw new Error("paid_at invalid");
}

export async function settlementImport(req: Request, res: Response) {
  try {
    await ensureSettlementTable();

    const contentType = String(req.headers["content-type"] || "").split(";")[0];
    let rows: SettlementImportRow[];
    if (contentType === "text/csv" || contentType === "application/csv") {
      const body = typeof req.body === "string" ? req.body : "";
      rows = parseCsv(body);
    } else if (contentType === "application/json") {
      rows = parseJson(req.body);
    } else if (typeof req.body === "string" && req.body.includes(",")) {
      rows = parseCsv(req.body);
    } else {
      rows = parseJson(req.body);
    }

    if (!rows.length) {
      return res.status(400).json({ error: "No settlement rows provided" });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const updated: string[] = [];
      for (const row of rows) {
        validateRow(row);
        const paidAt = new Date(row.paid_at);
        const { rows: existing } = await client.query(
          `SELECT id, abn, tax_type, period_id, amount_cents FROM settlements WHERE provider_ref=$1`,
          [row.provider_ref]
        );
        if (!existing.length) {
          // nothing to reconcile yet; skip but record for visibility
          continue;
        }
        const current = existing[0];
        await client.query(
          `UPDATE settlements
             SET paid_at = $2,
                 amount_cents = COALESCE($3, amount_cents),
                 rail = COALESCE($4, rail),
                 recon_payload = $5::jsonb,
                 evidence_uri = COALESCE($6, evidence_uri),
                 updated_at = NOW()
           WHERE provider_ref = $1`,
          [
            row.provider_ref,
            paidAt,
            Number.isFinite(row.amount_cents) ? row.amount_cents : current.amount_cents,
            row.rail ?? current.rail,
            JSON.stringify({ provider_ref: row.provider_ref, paid_at: paidAt.toISOString(), amount_cents: row.amount_cents, rail: row.rail ?? current.rail }),
            row.evidence_uri ?? null,
          ]
        );
        updated.push(row.provider_ref);
      }
      await client.query("COMMIT");
      return res.json({ ingested: updated.length, provider_refs: updated });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  } catch (e: any) {
    return res.status(400).json({ error: String(e?.message || e) });
  }
}
