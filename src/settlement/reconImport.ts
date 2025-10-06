import { parse } from "csv-parse/sync";
import { Pool } from "pg";
import { markSettlementPaid, linkSettlementEvidence } from "./store";

export interface ImportFile {
  filename: string;
  contents: Buffer | string;
}

export interface ReconRow {
  providerRef?: string;
  statementRef?: string;
  amountCents?: number;
  paidAt?: string;
  raw: Record<string, any>;
}

export interface ReconResult extends ReconRow {
  matched: boolean;
  settlementId?: string;
  evidenceId?: string | null;
  period?: { abn: string; taxType: string; periodId: string };
}

const pool = new Pool();

export async function importReconciliationFile(file: ImportFile): Promise<{ matched: ReconResult[]; unmatched: ReconResult[] }> {
  const rows = normaliseRows(file);
  const matched: ReconResult[] = [];
  const unmatched: ReconResult[] = [];

  for (const row of rows) {
    if (!row.providerRef && !row.statementRef) {
      unmatched.push({ ...row, matched: false });
      continue;
    }

    const paidAt = row.paidAt ?? new Date().toISOString();
    const settlement = await markSettlementPaid({
      providerRef: row.providerRef,
      statementRef: row.statementRef,
      paidAt,
    });

    if (!settlement) {
      unmatched.push({ ...row, matched: false });
      continue;
    }

    const evidenceId = await latestEvidenceForPeriod(settlement.period_id);
    if (evidenceId) {
      await linkSettlementEvidence(settlement.id, evidenceId);
    }

    const period = await periodDetails(settlement.period_id);

    matched.push({
      ...row,
      matched: true,
      settlementId: settlement.id,
      statementRef: settlement.statement_ref ?? row.statementRef,
      providerRef: settlement.provider_ref ?? row.providerRef,
      evidenceId: evidenceId ?? null,
      period: period || undefined,
    });
  }

  return { matched, unmatched };
}

async function latestEvidenceForPeriod(periodDbId: number | string): Promise<number | null> {
  const { rows } = await pool.query(
    `SELECT eb.bundle_id
     FROM evidence_bundles eb
     JOIN periods p ON p.abn = eb.abn AND p.tax_type = eb.tax_type AND p.period_id = eb.period_id
     WHERE p.id = $1
     ORDER BY eb.created_at DESC
     LIMIT 1`,
    [periodDbId]
  );
  return rows[0]?.bundle_id ?? null;
}

async function periodDetails(periodDbId: number | string): Promise<{ abn: string; taxType: string; periodId: string } | null> {
  const { rows } = await pool.query(
    `SELECT abn, tax_type, period_id
     FROM periods
     WHERE id = $1`,
    [periodDbId]
  );
  if (!rows.length) return null;
  return { abn: rows[0].abn, taxType: rows[0].tax_type, periodId: rows[0].period_id };
}

function normaliseRows(file: ImportFile): ReconRow[] {
  const text = typeof file.contents === "string" ? file.contents : file.contents.toString("utf8");
  if (!text.trim()) return [];

  if (file.filename.endsWith(".json") || text.trim().startsWith("[")) {
    const data = JSON.parse(text);
    if (Array.isArray(data)) {
      return data.map(row => normaliseRow(row));
    }
    return [normaliseRow(data)];
  }

  if (file.filename.endsWith(".xml") || text.trim().startsWith("<")) {
    return parseXmlRows(text).map(row => normaliseRow(row));
  }

  const records = parse(text, { columns: true, skip_empty_lines: true });
  return (records as Record<string, any>[]).map(row => normaliseRow(row));
}

function normaliseRow(row: Record<string, any>): ReconRow {
  const normalised: Record<string, any> = {};
  Object.entries(row || {}).forEach(([key, value]) => {
    normalised[key.toLowerCase()] = typeof value === "string" ? value.trim() : value;
  });

  const providerRef = (normalised["provider_ref"] || normalised["providerref"] || normalised["receipt"] || normalised["reference"]) as string | undefined;
  const statementRef = (normalised["statement_ref"] || normalised["statementref"] || normalised["statement"] || normalised["trace"] ) as string | undefined;
  const amountRaw = normalised["amount_cents"] ?? normalised["amount"] ?? normalised["value"];
  const paidAt = (normalised["paid_at"] || normalised["settled_at"] || normalised["date"] || normalised["value_date"]) as string | undefined;

  return {
    providerRef: providerRef || undefined,
    statementRef: statementRef || undefined,
    amountCents: amountRaw != null ? toCents(amountRaw) : undefined,
    paidAt: paidAt || undefined,
    raw: row,
  };
}

function toCents(value: any): number {
  if (typeof value === "number") return Math.round(value);
  const str = String(value).replace(/[^0-9.-]/g, "");
  if (!str) return 0;
  if (str.includes(".")) {
    return Math.round(parseFloat(str) * 100);
  }
  return Number(str);
}

function parseXmlRows(xml: string): Record<string, any>[] {
  const rows: Record<string, any>[] = [];
  const rowRegex = /<row>([\s\S]*?)<\/row>/gi;
  let match: RegExpExecArray | null;
  while ((match = rowRegex.exec(xml))) {
    const segment = match[1];
    const values: Record<string, any> = {};
    const fieldRegex = /<([^>]+)>([^<]*)<\/\1>/g;
    let field: RegExpExecArray | null;
    while ((field = fieldRegex.exec(segment))) {
      values[field[1]] = field[2];
    }
    rows.push(values);
  }
  if (!rows.length) {
    const single: Record<string, any> = {};
    const fieldRegex = /<([^>]+)>([^<]*)<\/\1>/g;
    let field: RegExpExecArray | null;
    while ((field = fieldRegex.exec(xml))) {
      single[field[1]] = field[2];
    }
    if (Object.keys(single).length) rows.push(single);
  }
  return rows;
}
