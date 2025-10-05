import type { Pool, PoolClient, QueryResult } from "pg";

export type Rail = "EFT" | "BPAY" | "PayTo" | "PAYTO" | "PAYID";

export type AllowlistDestination = {
  bsb?: string;
  acct?: string;
  bpay_biller?: string;
  crn?: string;
  payid?: string;
};

export interface RemittanceDestination {
  id: number;
  abn: string;
  rail: Rail;
  reference: string;
  account_bsb: string | null;
  account_number: string | null;
  metadata: Record<string, any>;
}

type Queryable = Pick<Pool, "query"> | PoolClient | { query: (text: string, params?: any[]) => Promise<QueryResult<any>> };

const CANDIDATE_META_COLUMNS = ["settings", "metadata", "rail_settings", "config", "destination_settings"] as const;

let cachedColumnSelect: string | null = null;

function isQueryable(obj: any): obj is Queryable {
  return obj && typeof obj.query === "function";
}

async function ensureColumnSelect(db: Queryable): Promise<string> {
  if (cachedColumnSelect) return cachedColumnSelect;
  const placeholders = CANDIDATE_META_COLUMNS.map((_, idx) => `$${idx + 1}`).join(",");
  const { rows } = await db.query(
    `SELECT column_name
       FROM information_schema.columns
      WHERE table_name = 'remittance_destinations'
        AND table_schema = ANY (current_schemas(false))
        AND column_name = ANY(ARRAY[${placeholders}])`,
    [...CANDIDATE_META_COLUMNS]
  );
  const found = new Set(rows.map(r => String(r.column_name)));
  const extras = Array.from(found)
    .sort()
    .map(col => `, ${col}`)
    .join("");
  cachedColumnSelect = `SELECT id, abn, rail, reference, account_bsb, account_number${extras} FROM remittance_destinations WHERE abn = $1`;
  return cachedColumnSelect;
}

function parseMaybeJson(value: unknown): any {
  if (value == null) return undefined;
  if (typeof value === "object") return value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return undefined;
    try {
      return JSON.parse(trimmed);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function mergeMetadata(base: Record<string, any>, addition: any) {
  if (!addition || typeof addition !== "object") return;
  for (const [key, val] of Object.entries(addition)) {
    if (val && typeof val === "object" && !Array.isArray(val)) {
      if (!base[key] || typeof base[key] !== "object") base[key] = {};
      mergeMetadata(base[key], val);
    } else {
      base[key] = val;
    }
  }
}

function normaliseDigits(value: string | null | undefined): string {
  if (!value) return "";
  return value.replace(/[^0-9]/g, "");
}

export function normaliseBsb(value: string | null | undefined): string {
  const digits = normaliseDigits(value);
  if (digits.length === 6) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return digits;
}

function extractCrnRange(meta: any): { min: number; max: number; prefix?: string } | null {
  if (!meta) return null;
  const source = meta.crn ?? meta.crn_range ?? meta.crnRange ?? meta.range ?? meta;
  const prefix = source?.prefix ?? meta.prefix ?? undefined;

  const tryNumbers = (...keys: string[]) => {
    for (const key of keys) {
      const val = source?.[key] ?? meta?.[key];
      if (typeof val === "number" && Number.isFinite(val)) return val;
    }
    return undefined;
  };

  let min = tryNumbers("min", "min_length", "minLength", "minDigits", "min_digits");
  let max = tryNumbers("max", "max_length", "maxLength", "maxDigits", "max_digits");

  if (typeof source?.length === "number") {
    min = max = source.length;
  }
  if (Array.isArray(source?.lengths) && source.lengths.length) {
    const nums = source.lengths.map((n: any) => Number(n)).filter((n: number) => Number.isFinite(n));
    if (nums.length) {
      min = Math.min(...nums);
      max = Math.max(...nums);
    }
  }
  if (Array.isArray(source?.range) && source.range.length >= 2) {
    const [a, b] = source.range;
    if (Number.isFinite(Number(a)) && Number.isFinite(Number(b))) {
      min = Number(a);
      max = Number(b);
    }
  }
  if (typeof source?.min === "number" && typeof source?.max === "number") {
    min = source.min;
    max = source.max;
  }

  if (typeof min === "number" && typeof max === "number" && min > 0 && max >= min) {
    return { min, max, prefix: typeof prefix === "string" && prefix ? prefix : undefined };
  }
  return null;
}

function inflateRow(raw: any): RemittanceDestination {
  const metadata: Record<string, any> = {};
  for (const key of CANDIDATE_META_COLUMNS) {
    if (key in raw) mergeMetadata(metadata, parseMaybeJson(raw[key]));
  }
  mergeMetadata(metadata, parseMaybeJson(raw.account_bsb));
  mergeMetadata(metadata, parseMaybeJson(raw.account_number));
  return {
    id: Number(raw.id),
    abn: String(raw.abn),
    rail: String(raw.rail) as Rail,
    reference: String(raw.reference),
    account_bsb: raw.account_bsb ?? null,
    account_number: raw.account_number ?? null,
    metadata,
  };
}

async function loadDestinations(db: Queryable, abn: string): Promise<RemittanceDestination[]> {
  if (!isQueryable(db)) throw new Error("Database connection missing query method");
  const sql = await ensureColumnSelect(db);
  const { rows } = await db.query(sql, [abn]);
  return rows.map(inflateRow);
}

function matchEft(rows: RemittanceDestination[], dest: AllowlistDestination): RemittanceDestination | null {
  const wantBsb = normaliseDigits(dest.bsb ?? "");
  const wantAcct = normaliseDigits(dest.acct ?? "");
  if (!wantBsb || !wantAcct) return null;
  for (const row of rows) {
    if (String(row.rail).toUpperCase() !== "EFT") continue;
    if (normaliseDigits(row.account_bsb ?? "") !== wantBsb) continue;
    if (normaliseDigits(row.account_number ?? "") !== wantAcct) continue;
    return row;
  }
  return null;
}

function matchBpay(rows: RemittanceDestination[], dest: AllowlistDestination): RemittanceDestination | null {
  const biller = (dest.bpay_biller || "").trim();
  const crn = (dest.crn || "").trim();
  if (!biller || !crn || !/^\d+$/.test(crn)) return null;
  const length = crn.length;
  for (const row of rows) {
    if (String(row.rail).toUpperCase() !== "BPAY") continue;
    if (String(row.reference) !== biller) continue;
    const meta = row.metadata?.bpay ?? row.metadata;
    const range = extractCrnRange(meta);
    if (!range) continue;
    if (range.prefix && !crn.startsWith(range.prefix)) continue;
    if (length < range.min || length > range.max) continue;
    return row;
  }
  return null;
}

function matchPayTo(rows: RemittanceDestination[], dest: AllowlistDestination): RemittanceDestination | null {
  const handle = (dest.payid || "").trim();
  if (!handle) return null;
  for (const row of rows) {
    const rail = String(row.rail).toUpperCase();
    if (rail !== "PAYTO" && rail !== "PAYID") continue;
    const knownHandle = row.metadata?.payto?.handle ?? row.metadata?.payid?.handle ?? row.metadata?.handle;
    if (typeof knownHandle === "string" && knownHandle.trim().length) {
      if (knownHandle.trim().toLowerCase() === handle.toLowerCase()) return row;
      continue;
    }
    if (row.reference.trim().toLowerCase() === handle.toLowerCase()) return row;
  }
  return null;
}

export async function matchAllowlistedDestination(db: Queryable, abn: string, dest: AllowlistDestination): Promise<RemittanceDestination | null> {
  const rows = await loadDestinations(db, abn);
  if (dest.bpay_biller) return matchBpay(rows, dest);
  if (dest.bsb && dest.acct) return matchEft(rows, dest);
  if (dest.payid) return matchPayTo(rows, dest);
  return null;
}

export async function resolveDestinationByReference(db: Queryable, abn: string, rail: Rail, reference: string): Promise<RemittanceDestination | null> {
  const rows = await loadDestinations(db, abn);
  const targetRail = String(rail).toUpperCase();
  for (const row of rows) {
    if (String(row.reference) !== reference) continue;
    const rowRail = String(row.rail).toUpperCase();
    if (rowRail === targetRail) return row;
    if (targetRail === "PAYTO" && (rowRail === "PAYTO" || rowRail === "PAYID")) return row;
  }
  return null;
}

export async function listDestinations(db: Queryable, abn: string): Promise<RemittanceDestination[]> {
  return loadDestinations(db, abn);
}
