import type { Pool, PoolClient } from "pg";
import { markPayoutMatched } from "./payoutLedger.js";
import { ensureBankReconSchema } from "./schema.js";

export interface BankCsvIngestParams {
  abn: string;
  taxType?: string;
  periodId?: string;
  csv: string;
  simulateWeekendPosting?: boolean;
  cutoffHourUtc?: number;
}

export interface BankIngestResult {
  ingested: number;
  matched: number;
  unresolved: number;
  matches: Array<{ bank_txn_id: string; release_uuid: string; strategy: string }>;
}

export interface UnresolvedLine {
  bank_txn_id: string;
  statement_date: string;
  amount_cents: number;
  reference: string;
  created_at: string;
}

type ParsedRow = {
  bank_txn_id: string;
  reference: string;
  amount_cents: number;
  statement_date: Date;
  raw: Record<string, string>;
};

function parseCsv(text: string): Array<Record<string, string>> {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return [];
  const headers = lines[0].split(",").map((h) => h.trim().toLowerCase());
  return lines.slice(1).map((line) => {
    const cols = line.split(",").map((c) => c.trim());
    const record: Record<string, string> = {};
    headers.forEach((h, idx) => {
      record[h] = cols[idx] ?? "";
    });
    return record;
  });
}

function parseAmount(raw: string): number {
  const cleaned = raw.replace(/[$,]/g, "").trim();
  if (!cleaned) throw new Error("Missing amount");
  const num = Number(cleaned);
  if (!Number.isFinite(num)) throw new Error(`Invalid amount: ${raw}`);
  return Math.round(num * 100);
}

function parseDate(raw: string): Date {
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) throw new Error(`Invalid date: ${raw}`);
  return d;
}

function adjustPostingDate(d: Date, weekend: boolean | undefined, cutoffHour: number | undefined): Date {
  const out = new Date(d.getTime());
  if (typeof cutoffHour === "number" && cutoffHour >= 0 && cutoffHour < 24) {
    if (out.getUTCHours() >= cutoffHour) {
      out.setUTCDate(out.getUTCDate() + 1);
    }
  }
  out.setUTCHours(0, 0, 0, 0);
  if (weekend) {
    const day = out.getUTCDay();
    if (day === 6) {
      out.setUTCDate(out.getUTCDate() + 2);
    } else if (day === 0) {
      out.setUTCDate(out.getUTCDate() + 1);
    }
  }
  return out;
}

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function daysApart(a: Date, b: Date): number {
  const ms = Math.abs(a.getTime() - b.getTime());
  return Math.floor(ms / (24 * 60 * 60 * 1000));
}

async function applyMatch(
  client: PoolClient,
  bank_txn_id: string,
  release: { release_uuid: string; tax_type: string; period_id: string },
  strategy: string
) {
  await client.query(
    `UPDATE bank_statement_lines
       SET status='MATCHED', match_strategy=$2, matched_release_uuid=$3, matched_at=now(),
           tax_type=$4, period_id=$5
     WHERE bank_txn_id=$1`,
    [bank_txn_id, strategy, release.release_uuid, release.tax_type, release.period_id]
  );
}

async function matchLine(
  pool: Pool,
  abn: string,
  line: ParsedRow,
  options: { weekend?: boolean; cutoffHour?: number },
  defaults: { taxType?: string; periodId?: string }
): Promise<{ release_uuid: string; strategy: string } | null> {
  const client = await pool.connect();
  try {
    await ensureBankReconSchema(client);
    const statementDate = adjustPostingDate(line.statement_date, options.weekend, options.cutoffHour);
    const statementIso = toIsoDate(statementDate);

    // UPSERT the bank line first so status is known
    const insert = await client.query(
      `INSERT INTO bank_statement_lines
         (bank_txn_id, abn, statement_date, amount_cents, reference, raw_payload, tax_type, period_id)
       VALUES ($1,$2,$3::date,$4,$5,$6::jsonb,$7,$8)
       ON CONFLICT (bank_txn_id) DO UPDATE
         SET statement_date = EXCLUDED.statement_date,
             amount_cents = EXCLUDED.amount_cents,
             reference = EXCLUDED.reference,
             raw_payload = EXCLUDED.raw_payload,
             tax_type = COALESCE(bank_statement_lines.tax_type, EXCLUDED.tax_type),
             period_id = COALESCE(bank_statement_lines.period_id, EXCLUDED.period_id)
       RETURNING status, matched_release_uuid`,
      [
        line.bank_txn_id,
        abn,
        statementIso,
        line.amount_cents,
        line.reference,
        JSON.stringify(line.raw),
        defaults.taxType ?? null,
        defaults.periodId ?? null,
      ]
    );
    const current = insert.rows[0];
    if (current?.matched_release_uuid) {
      return { release_uuid: current.matched_release_uuid, strategy: "PREVIOUS" };
    }

    // Step 1: strict reference match
    const ref = await client.query(
      `SELECT release_uuid, amount_cents, created_at, tax_type, period_id
         FROM payout_releases
        WHERE abn=$1 AND reference=$2 AND matched_bank_txn_id IS NULL
        ORDER BY created_at ASC
        LIMIT 5`,
      [abn, line.reference]
    );
    for (const row of ref.rows) {
      if (Number(row.amount_cents) === line.amount_cents) {
        await markPayoutMatched(client, row.release_uuid, line.bank_txn_id, "REFERENCE");
        await applyMatch(client, line.bank_txn_id, row, "REFERENCE");
        return { release_uuid: row.release_uuid, strategy: "REFERENCE" };
      }
    }

    // Step 2: amount/date proximity
    const candidates = await client.query(
      `SELECT release_uuid, amount_cents, created_at, tax_type, period_id
         FROM payout_releases
        WHERE abn=$1 AND matched_bank_txn_id IS NULL
          AND ABS(amount_cents - $2) <= 1`,
      [abn, line.amount_cents]
    );
    for (const row of candidates.rows) {
      const created = new Date(row.created_at);
      created.setUTCHours(0, 0, 0, 0);
      const diff = daysApart(created, statementDate);
      if (diff <= 2) {
        await markPayoutMatched(client, row.release_uuid, line.bank_txn_id, "FUZZY");
        await applyMatch(client, line.bank_txn_id, row, "FUZZY");
        return { release_uuid: row.release_uuid, strategy: "FUZZY" };
      }
    }

    // no match
    await client.query(
      `UPDATE bank_statement_lines
         SET status='UNRESOLVED', match_strategy=NULL, matched_release_uuid=NULL
       WHERE bank_txn_id=$1`,
      [line.bank_txn_id]
    );
    return null;
  } finally {
    client.release();
  }
}

export async function ingestBankStatementCsv(pool: Pool, params: BankCsvIngestParams): Promise<BankIngestResult> {
  const bootstrap = await pool.connect();
  try {
    await ensureBankReconSchema(bootstrap);
  } finally {
    bootstrap.release();
  }

  const rows = parseCsv(params.csv).map((raw) => {
    const row: ParsedRow = {
      bank_txn_id: raw.bank_txn_id ?? raw["bank_txn_id"],
      reference: raw.reference ?? "",
      amount_cents: parseAmount(raw.amount ?? raw["amount"] ?? "0"),
      statement_date: parseDate(raw.date ?? raw["date"] ?? ""),
      raw,
    };
    row.reference = row.reference.trim();
    if (!row.bank_txn_id) throw new Error("Missing bank_txn_id column");
    if (!row.reference) throw new Error("Missing reference");
    return row;
  });

  let matched = 0;
  for (const line of rows) {
    const result = await matchLine(
      pool,
      params.abn,
      line,
      {
        weekend: params.simulateWeekendPosting,
        cutoffHour: params.cutoffHourUtc,
      },
      { taxType: params.taxType, periodId: params.periodId }
    );
    if (result) matched += 1;
  }

  const unresolvedCount = await pool.query(
    `SELECT COUNT(*)::int AS ct FROM bank_statement_lines WHERE abn=$1 AND status='UNRESOLVED'`,
    [params.abn]
  );
  const matches = await pool.query(
    `SELECT bank_txn_id, matched_release_uuid AS release_uuid, match_strategy
       FROM bank_statement_lines
      WHERE abn=$1 AND matched_release_uuid IS NOT NULL
      ORDER BY matched_at ASC`,
    [params.abn]
  );

  return {
    ingested: rows.length,
    matched,
    unresolved: Number(unresolvedCount.rows[0]?.ct || 0),
    matches: matches.rows.map((r) => ({
      bank_txn_id: r.bank_txn_id,
      release_uuid: r.release_uuid,
      strategy: r.match_strategy || "UNKNOWN",
    })),
  };
}

export async function listUnresolved(pool: Pool, abn: string): Promise<UnresolvedLine[]> {
  const { rows } = await pool.query(
    `SELECT bank_txn_id, statement_date::text AS statement_date, amount_cents, reference, created_at::text AS created_at
       FROM bank_statement_lines
      WHERE abn=$1 AND status='UNRESOLVED'
      ORDER BY statement_date ASC, bank_txn_id ASC`,
    [abn]
  );
  return rows.map((r) => ({
    bank_txn_id: r.bank_txn_id,
    statement_date: r.statement_date,
    amount_cents: Number(r.amount_cents),
    reference: r.reference,
    created_at: r.created_at,
  }));
}
