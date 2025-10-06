import { Pool, QueryResult } from "pg";

export type Queryable = {
  query<T = any>(text: string, params?: any[]): Promise<QueryResult<T>>;
};

let sharedDb: Queryable = new Pool();

export function setEvidenceDb(db: Queryable) {
  sharedDb = db;
}

type BasLabels = { W1: number | null; W2: number | null; "1A": number | null; "1B": number | null };

const DEFAULT_BAS_LABELS: BasLabels = { W1: null, W2: null, "1A": null, "1B": null };

const LABEL_FIELD_MAP: Record<keyof BasLabels, string[]> = {
  W1: ["w1", "w1_cents", "w1_amount", "w1_amount_cents", "label_w1_cents", "gross_wages_cents"],
  W2: ["w2", "w2_cents", "w2_amount", "w2_amount_cents", "label_w2_cents", "withheld_cents"],
  "1A": ["1a", "label_1a", "label_1a_cents", "gst_payable_cents", "tax_1a_cents"],
  "1B": ["1b", "label_1b", "label_1b_cents", "gst_credits_cents", "tax_1b_cents"],
};

const ORDER_CANDIDATES = [
  "generated_at",
  "computed_at",
  "calculated_at",
  "created_at",
  "updated_at",
  "ingested_at",
  "detected_at",
  "ts",
  "timestamp",
  "id",
];

function pickNumeric(value: any): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (typeof value === "object" && value !== null && "value" in value) {
    return pickNumeric((value as any).value);
  }
  return null;
}

function parseLabelsFromJson(raw: any): BasLabels | null {
  if (!raw) return null;
  let obj: any = raw;
  if (typeof raw === "string") {
    try {
      obj = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (typeof obj !== "object" || obj === null) return null;
  const labels: BasLabels = { ...DEFAULT_BAS_LABELS };
  (Object.keys(labels) as Array<keyof BasLabels>).forEach(key => {
    const candidate = obj[key] ?? obj[String(key).toLowerCase()] ?? obj[String(key).toUpperCase()];
    labels[key] = pickNumeric(candidate);
  });
  return labels;
}

function normalizeDate(value: any): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const d = new Date(value);
  return Number.isNaN(d.valueOf()) ? null : d.toISOString();
}

function coalesceTimestamp(row: Record<string, any>): string | null {
  for (const field of ORDER_CANDIDATES) {
    const value = row[field];
    if (value === undefined || value === null) continue;
    const ts = normalizeDate(value);
    if (ts) return ts;
  }
  return null;
}

function quoteIdent(name: string) {
  return `"${name.replace(/"/g, '""')}"`;
}

async function tableExists(table: string) {
  const [schema, name] = table.includes(".") ? table.split(".") : ["public", table];
  const { rows } = await sharedDb.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1
         FROM pg_catalog.pg_class c
         JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname=$1 AND c.relname=$2 AND c.relkind='r'
     ) AS exists`,
    [schema, name]
  );
  return rows[0]?.exists ?? false;
}

async function fetchTableColumns(table: string) {
  const [schema, name] = table.includes(".") ? table.split(".") : ["public", table];
  const { rows } = await sharedDb.query<{ column_name: string }>(
    `SELECT column_name
       FROM information_schema.columns
      WHERE table_schema=$1 AND table_name=$2`,
    [schema, name]
  );
  return rows.map(r => r.column_name);
}

async function fetchBasLabels(abn: string, taxType: string, periodId: string) {
  const candidates = [
    "bas_engine_outputs",
    "bas_engine_snapshots",
    "bas_engine_results",
    "bas_labels",
    "bas_returns",
  ];
  for (const table of candidates) {
    if (!(await tableExists(table))) continue;
    const columns = await fetchTableColumns(table);
    if (!columns.includes("abn")) continue;
    const periodCol = columns.includes("period_id") ? "period_id" : columns.includes("period") ? "period" : null;
    if (!periodCol) continue;
    const taxCol = columns.includes("tax_type") ? "tax_type" : columns.includes("tax") ? "tax" : null;
    if (!taxCol) continue;

    const selectable: string[] = [];
    if (columns.includes("labels")) selectable.push(`${quoteIdent("labels")}`);
    (Object.keys(LABEL_FIELD_MAP) as Array<keyof BasLabels>).forEach(key => {
      const col = LABEL_FIELD_MAP[key].find(name => columns.includes(name));
      if (col) selectable.push(`${quoteIdent(col)} AS ${quoteIdent(String(key).toLowerCase())}`);
    });
    ORDER_CANDIDATES.forEach(col => {
      if (columns.includes(col)) selectable.push(`${quoteIdent(col)}`);
    });

    if (!selectable.length) continue;
    const orderBy = ORDER_CANDIDATES.find(col => columns.includes(col));

    const sql = `SELECT ${selectable.join(", ")}
      FROM ${table}
     WHERE abn=$1 AND ${quoteIdent(taxCol)}=$2 AND ${quoteIdent(periodCol)}=$3
     ${orderBy ? `ORDER BY ${quoteIdent(orderBy)} DESC` : ""}
     LIMIT 1`;

    try {
      const { rows } = await sharedDb.query<Record<string, any>>(sql, [abn, taxType, periodId]);
      if (!rows.length) continue;
      const row = rows[0];
      let labels = parseLabelsFromJson(row.labels);
      if (!labels) {
        labels = { ...DEFAULT_BAS_LABELS };
        (Object.keys(LABEL_FIELD_MAP) as Array<keyof BasLabels>).forEach(key => {
          const alias = String(key).toLowerCase();
          const value = row[alias];
          const numeric = pickNumeric(value);
          if (numeric !== null) labels![key] = numeric;
        });
      } else {
        (Object.keys(labels) as Array<keyof BasLabels>).forEach(key => {
          labels![key] = pickNumeric(labels![key]);
        });
      }
      const generatedAt = coalesceTimestamp(row);
      return { labels, generatedAt };
    } catch {
      // try next candidate
    }
  }
  return { labels: { ...DEFAULT_BAS_LABELS }, generatedAt: null };
}

type ReconLogEntry = {
  txn_id: string | null;
  field: string | null;
  expected_cents: number | null;
  actual_cents: number | null;
  variance_cents: number | null;
  details: any;
  detected_at: string | null;
  reason: string | null;
};

const RECON_TABLE_CANDIDATES = [
  { table: "reconciliation_diffs", jsonColumn: "diff" },
  { table: "recon_diffs", jsonColumn: "diff" },
  { table: "reconciliation_diff_log", jsonColumn: "diff" },
];

async function fetchDiscrepancyLog(abn: string, taxType: string, periodId: string) {
  for (const candidate of RECON_TABLE_CANDIDATES) {
    if (!(await tableExists(candidate.table))) continue;
    const columns = await fetchTableColumns(candidate.table);
    if (!columns.includes("abn")) continue;
    const periodCol = columns.includes("period_id") ? "period_id" : columns.includes("period") ? "period" : null;
    if (!periodCol) continue;
    const taxCol = columns.includes("tax_type") ? "tax_type" : columns.includes("tax") ? "tax" : null;
    if (!taxCol) continue;

    const selectCols: string[] = [];
    if (columns.includes(candidate.jsonColumn)) selectCols.push(`${quoteIdent(candidate.jsonColumn)} AS diff_json`);
    ["txn_id", "field", "expected_cents", "actual_cents", "variance_cents", "reason"].forEach(col => {
      if (columns.includes(col)) selectCols.push(`${quoteIdent(col)}`);
    });
    ORDER_CANDIDATES.forEach(col => {
      if (columns.includes(col)) selectCols.push(`${quoteIdent(col)}`);
    });
    if (!selectCols.length) continue;
    const orderBy = ORDER_CANDIDATES.find(col => columns.includes(col));

    const sql = `SELECT ${selectCols.join(", ")}
      FROM ${candidate.table}
     WHERE abn=$1 AND ${quoteIdent(taxCol)}=$2 AND ${quoteIdent(periodCol)}=$3
     ${orderBy ? `ORDER BY ${quoteIdent(orderBy)} ASC` : ""}`;

    try {
      const { rows } = await sharedDb.query<Record<string, any>>(sql, [abn, taxType, periodId]);
      if (!rows.length) continue;
      return rows.map(row => {
        const entry: ReconLogEntry = {
          txn_id: row.txn_id ?? null,
          field: row.field ?? null,
          expected_cents: pickNumeric(row.expected_cents),
          actual_cents: pickNumeric(row.actual_cents),
          variance_cents: pickNumeric(row.variance_cents),
          details: (() => {
            const raw = row.diff_json ?? row.diff ?? row.details;
            if (!raw) return null;
            if (typeof raw === "string") {
              try {
                return JSON.parse(raw);
              } catch {
                return raw;
              }
            }
            return raw;
          })(),
          detected_at: coalesceTimestamp(row),
          reason: row.reason ?? null,
        };
        return entry;
      });
    } catch {
      // try next candidate
    }
  }
  return [] as ReconLogEntry[];
}

export async function buildEvidenceBundle(abn: string, taxType: string, periodId: string) {
  if (!abn || !taxType || !periodId) {
    throw new Error("INVALID_IDENTIFIERS");
  }

  const periodRes = await sharedDb.query(
    "SELECT * FROM periods WHERE abn=$1 AND tax_type=$2 AND period_id=$3",
    [abn, taxType, periodId]
  );
  const period = periodRes.rows[0] || null;

  const rptRes = await sharedDb.query(
    `SELECT payload, payload_c14n, payload_sha256, signature, created_at
       FROM rpt_tokens
      WHERE abn=$1 AND tax_type=$2 AND period_id=$3
      ORDER BY id DESC LIMIT 1`,
    [abn, taxType, periodId]
  );
  const rpt = rptRes.rows[0] || null;

  const ledgerRes = await sharedDb.query(
    `SELECT id, transfer_uuid, amount_cents, balance_after_cents, bank_receipt_hash, prev_hash, hash_after, created_at
       FROM owa_ledger
      WHERE abn=$1 AND tax_type=$2 AND period_id=$3
      ORDER BY id ASC`,
    [abn, taxType, periodId]
  );
  const ledger = ledgerRes.rows.map(row => ({
    id: typeof row.id === "number" ? row.id : Number(row.id),
    transfer_uuid: row.transfer_uuid ?? null,
    amount_cents: pickNumeric(row.amount_cents),
    balance_after_cents: pickNumeric(row.balance_after_cents),
    bank_receipt_hash: row.bank_receipt_hash ?? null,
    prev_hash: row.prev_hash ?? null,
    hash_after: row.hash_after ?? null,
    created_at: normalizeDate(row.created_at),
  }));

  const lastLedger = ledger.length ? ledger[ledger.length - 1] : null;

  const { labels: basLabels, generatedAt } = await fetchBasLabels(abn, taxType, periodId);
  const discrepancyLog = await fetchDiscrepancyLog(abn, taxType, periodId);

  return {
    meta: {
      generated_at: new Date().toISOString(),
      abn,
      taxType,
      periodId,
    },
    period: period
      ? {
          state: period.state,
          accrued_cents: pickNumeric(period.accrued_cents) ?? 0,
          credited_to_owa_cents: pickNumeric(period.credited_to_owa_cents) ?? 0,
          final_liability_cents: pickNumeric(period.final_liability_cents) ?? 0,
          merkle_root: period.merkle_root ?? null,
          running_balance_hash: period.running_balance_hash ?? null,
          anomaly_vector: period.anomaly_vector ?? {},
          thresholds: period.thresholds ?? {},
        }
      : null,
    rpt_payload: rpt?.payload ?? null,
    rpt_signature: rpt?.signature ?? null,
    rpt_payload_sha256: rpt?.payload_sha256 ?? null,
    owa_ledger_deltas: ledger,
    bank_receipt_hash: lastLedger?.bank_receipt_hash ?? null,
    anomaly_thresholds: period?.thresholds ?? {},
    bas_labels: basLabels,
    bas_labels_generated_at: generatedAt,
    discrepancy_log: discrepancyLog,
  };
}
