import { parse } from "csv-parse/sync";
import { normalizeReference } from "./util";

export type StatementFormat = "csv" | "ofx" | "json";

export interface ParsedBankLine {
  valueDate: string;
  amountCents: number;
  reference: string | null;
  raw: any;
}

function toIsoDate(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date && !Number.isNaN(value.valueOf())) {
    return value.toISOString().slice(0, 10);
  }
  const str = String(value).trim();
  if (!str) return "";
  const compact = str.replace(/[^0-9]/g, "");
  if (/^\d{8}$/.test(compact)) {
    const y = compact.slice(0, 4);
    const m = compact.slice(4, 6);
    const d = compact.slice(6, 8);
    return `${y}-${m}-${d}`;
  }
  const parsed = new Date(str);
  if (!Number.isNaN(parsed.valueOf())) {
    return parsed.toISOString().slice(0, 10);
  }
  return "";
}

function toCents(value: unknown): number {
  if (value === null || value === undefined) return Number.NaN;
  if (typeof value === "number" && Number.isFinite(value)) return Math.round(value * 100);
  const str = String(value).trim();
  if (!str) return Number.NaN;
  const num = Number(str.replace(/[^0-9.-]/g, ""));
  if (!Number.isFinite(num)) return Number.NaN;
  return Math.round(num * 100);
}

function normalizeAmount(row: Record<string, unknown>): number {
  const candidates = [
    row.amount_cents,
    (row as any).amountCents,
    row.amount,
    row.total,
    row.value,
    row.credit,
    row.debit
  ];
  for (const candidate of candidates) {
    const cents = toCents(candidate);
    if (Number.isFinite(cents)) {
      if (candidate === row.debit && !(row.credit && toCents(row.credit))) {
        return -cents;
      }
      return cents;
    }
  }
  const credit = toCents(row.credit);
  const debit = toCents(row.debit);
  if (Number.isFinite(credit) && !Number.isFinite(debit)) return credit;
  if (Number.isFinite(debit) && !Number.isFinite(credit)) return -debit;
  if (Number.isFinite(credit) && Number.isFinite(debit)) return credit - debit;
  return Number.NaN;
}

function parseCsv(text: string): ParsedBankLine[] {
  const rows = parse(text, { columns: true, skip_empty_lines: true, trim: true });
  const lines: ParsedBankLine[] = [];
  rows.forEach((row: Record<string, unknown>) => {
    const date =
      toIsoDate(row.value_date) ||
      toIsoDate(row.date) ||
      toIsoDate(row.Date) ||
      toIsoDate(row.posted) ||
      toIsoDate(row["value date"]);
    const amount = normalizeAmount(row);
    if (!date || !Number.isFinite(amount)) return;
    const reference =
      row.reference ||
      row.Reference ||
      row.description ||
      row.Description ||
      row.memo ||
      row.Memo ||
      row.narrative ||
      row.Narrative ||
      row.ref;
    lines.push({
      valueDate: date,
      amountCents: amount,
      reference: reference ? String(reference) : null,
      raw: row
    });
  });
  return lines;
}

function matchTag(block: string, tag: string): string | null {
  const match = block.match(new RegExp(`<${tag}>([^<\r\n]+)`, "i"));
  return match ? match[1].trim() : null;
}

function parseOfx(text: string): ParsedBankLine[] {
  const entries = text.split(/<STMTTRN>/i).slice(1);
  const lines: ParsedBankLine[] = [];
  entries.forEach(entry => {
    const amount = toCents(matchTag(entry, "TRNAMT"));
    const date = toIsoDate(matchTag(entry, "DTPOSTED"));
    if (!date || !Number.isFinite(amount)) return;
    const memo = matchTag(entry, "MEMO") || matchTag(entry, "NAME") || matchTag(entry, "FITID");
    lines.push({
      valueDate: date,
      amountCents: amount,
      reference: memo,
      raw: { entry }
    });
  });
  return lines;
}

function parseJson(input: any): ParsedBankLine[] {
  const arr = Array.isArray(input)
    ? input
    : Array.isArray(input?.transactions)
    ? input.transactions
    : Array.isArray(input?.lines)
    ? input.lines
    : [];
  const lines: ParsedBankLine[] = [];
  arr.forEach((row: any) => {
    const amount = normalizeAmount(row);
    const date =
      toIsoDate(row.valueDate) ||
      toIsoDate(row.date) ||
      toIsoDate(row.posted) ||
      toIsoDate(row.settlementDate) ||
      toIsoDate(row.transactionDate);
    if (!date || !Number.isFinite(amount)) return;
    const reference =
      row.reference ||
      row.Reference ||
      row.description ||
      row.memo ||
      row.narrative ||
      row.ref;
    lines.push({
      valueDate: date,
      amountCents: amount,
      reference: reference ? String(reference) : null,
      raw: row
    });
  });
  return lines;
}

export function detectFormat(payload: any, explicit?: string | null): StatementFormat {
  if (explicit) {
    const normalized = explicit.toLowerCase();
    if (normalized === "ofx" || normalized === "json" || normalized === "csv") return normalized;
  }
  if (typeof payload === "string") {
    const trimmed = payload.trim();
    if (trimmed.startsWith("<")) return "ofx";
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) return "json";
    return "csv";
  }
  return "json";
}

export function parseBankStatement(payload: any, format?: StatementFormat): ParsedBankLine[] {
  const fmt = format || detectFormat(payload, typeof format === "string" ? format : undefined);
  let lines: ParsedBankLine[] = [];
  if (fmt === "csv") {
    const text = typeof payload === "string" ? payload : JSON.stringify(payload);
    lines = parseCsv(text);
  } else if (fmt === "ofx") {
    const text = typeof payload === "string" ? payload : String(payload ?? "");
    lines = parseOfx(text);
  } else {
    const data = typeof payload === "string" ? JSON.parse(payload) : payload;
    lines = parseJson(data);
  }
  return lines.map(line => ({
    ...line,
    reference: line.reference ?? null,
    raw: { ...line.raw, reference_normalized: normalizeReference(line.reference ?? undefined) }
  }));
}
