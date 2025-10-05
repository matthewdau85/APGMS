import { createHash } from "crypto";
import { Pool } from "pg";

type Queryable = {
  query: (text: string, params?: any[]) => Promise<any>;
};

type BasLabel = "W1" | "W2" | "1A" | "1B";
type BasLabels = Record<BasLabel, number | null>;

type DiscrepancyLogEntry = {
  source: "recon" | "anomaly";
  metric: string;
  observed: number | null;
  expected?: number | null;
  threshold?: number | null;
  status: "OK" | "EXCEEDED";
  notes?: string | null;
};

type AuditTrailEntry = {
  event_time: string | null;
  category: string;
  message: unknown;
  hash_prev: string | null;
  hash_this: string | null;
};

const pool = new Pool();

function canonicalString(value: unknown): string {
  if (value === null || value === undefined) {
    return "null";
  }
  if (typeof value !== "object") {
    if (typeof value === "number" && !Number.isFinite(value)) {
      return JSON.stringify(String(value));
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalString(v)).join(",")}]`;
  }
  const entries = Object.keys(value as Record<string, unknown>)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalString((value as Record<string, unknown>)[key])}`);
  return `{${entries.join(",")}}`;
}

function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const num = typeof value === "number" ? value : Number(value);
  return Number.isFinite(num) ? num : null;
}

async function safeQuery<T = any>(client: Queryable, sql: string, params: any[] = []): Promise<{ rows: T[]; rowCount: number }> {
  try {
    const result = await client.query(sql, params);
    const rows: T[] = result?.rows ?? [];
    const rowCount: number = typeof result?.rowCount === "number" ? result.rowCount : rows.length;
    return { rows, rowCount };
  } catch (err: any) {
    if (err?.code === "42P01" || err?.code === "42703") {
      return { rows: [], rowCount: 0 };
    }
    throw err;
  }
}

async function loadBasLabels(client: Queryable, abn: string, taxType: string, periodId: string): Promise<BasLabels> {
  const labels: BasLabels = { W1: null, W2: null, "1A": null, "1B": null };
  const { rows } = await safeQuery<{ label: string; value_cents: unknown }>(
    client,
    "SELECT label, value_cents FROM bas_recon_results WHERE abn=$1 AND tax_type=$2 AND period_id=$3",
    [abn, taxType, periodId]
  );
  for (const row of rows) {
    const key = row.label as keyof BasLabels;
    if (key in labels) {
      labels[key] = toNumberOrNull(row.value_cents);
    }
  }
  return labels;
}

async function loadDiscrepancyLog(
  client: Queryable,
  abn: string,
  taxType: string,
  periodId: string,
  anomalyVector: Record<string, unknown>,
  thresholds: Record<string, unknown>
): Promise<DiscrepancyLogEntry[]> {
  const { rows, rowCount } = await safeQuery<{
    metric: string;
    observed_value?: unknown;
    expected_value?: unknown;
    threshold_value?: unknown;
    status?: string;
    notes?: string | null;
  }>(
    client,
    "SELECT metric, observed_value, expected_value, threshold_value, status, notes FROM recon_discrepancies WHERE abn=$1 AND tax_type=$2 AND period_id=$3 ORDER BY observed_at",
    [abn, taxType, periodId]
  );
  if (rowCount > 0) {
    return rows.map((row) => {
      const observed = toNumberOrNull(row.observed_value);
      const expected = toNumberOrNull(row.expected_value);
      const threshold = toNumberOrNull(row.threshold_value);
      const exceeded = threshold !== null && observed !== null ? Math.abs(observed) > threshold : false;
      return {
        source: "recon",
        metric: row.metric,
        observed,
        expected,
        threshold,
        status: exceeded || row.status === "EXCEEDED" ? "EXCEEDED" : "OK",
        notes: row.notes ?? null,
      } satisfies DiscrepancyLogEntry;
    });
  }
  const entries: DiscrepancyLogEntry[] = [];
  for (const [metric, value] of Object.entries(anomalyVector ?? {})) {
    const observed = toNumberOrNull(value);
    const threshold = toNumberOrNull((thresholds ?? {})[metric]);
    const exceeded = threshold !== null && observed !== null ? Math.abs(observed) > threshold : false;
    entries.push({
      source: "anomaly",
      metric,
      observed,
      threshold,
      status: exceeded ? "EXCEEDED" : "OK",
      notes: exceeded ? "anomaly vector exceeded threshold" : null,
    });
  }
  return entries;
}

function parseAuditMessage(input: any): unknown {
  if (input === null || input === undefined) return null;
  if (typeof input === "string") {
    const trimmed = input.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        return JSON.parse(trimmed);
      } catch {
        return input;
      }
    }
    return input;
  }
  return input;
}

async function loadAuditTrail(client: Queryable, periodId: string): Promise<AuditTrailEntry[]> {
  const pattern = `%"period_id":"${periodId}"%`;
  const { rows } = await safeQuery<{
    event_time: Date | string | null;
    category: string;
    message: unknown;
    hash_prev: string | null;
    hash_this: string | null;
  }>(
    client,
    "SELECT event_time, category, message, hash_prev, hash_this FROM audit_log WHERE message LIKE $1 ORDER BY event_time",
    [pattern]
  );
  return rows.map((row) => ({
    event_time:
      row.event_time instanceof Date
        ? row.event_time.toISOString()
        : row.event_time !== null
        ? String(row.event_time)
        : null,
    category: row.category,
    message: parseAuditMessage(row.message),
    hash_prev: row.hash_prev ?? null,
    hash_this: row.hash_this ?? null,
  }));
}

export async function buildEvidenceBundle(
  abn: string,
  taxType: string,
  periodId: string,
  client: Queryable = pool
) {
  const periodResult = await safeQuery<any>(
    client,
    "SELECT * FROM periods WHERE abn=$1 AND tax_type=$2 AND period_id=$3",
    [abn, taxType, periodId]
  );
  const periodRow = periodResult.rows[0] ?? null;

  const rptResult = await safeQuery<any>(
    client,
    "SELECT payload, signature FROM rpt_tokens WHERE abn=$1 AND tax_type=$2 AND period_id=$3 ORDER BY created_at DESC LIMIT 1",
    [abn, taxType, periodId]
  );
  const rptRow = rptResult.rows[0] ?? null;

  const deltasResult = await safeQuery<any>(
    client,
    "SELECT created_at AS ts, amount_cents, hash_after, bank_receipt_hash FROM owa_ledger WHERE abn=$1 AND tax_type=$2 AND period_id=$3 ORDER BY id",
    [abn, taxType, periodId]
  );
  const owaLedger = deltasResult.rows.map((row) => ({
    ...row,
    amount_cents: toNumberOrNull(row.amount_cents) ?? row.amount_cents,
  }));
  const lastLedger = owaLedger[owaLedger.length - 1];

  const basLabels = await loadBasLabels(client, abn, taxType, periodId);
  const anomalyVector = (periodRow?.anomaly_vector as Record<string, unknown>) ?? {};
  const thresholds = (periodRow?.thresholds as Record<string, unknown>) ?? {};
  const discrepancyLog = await loadDiscrepancyLog(client, abn, taxType, periodId, anomalyVector, thresholds);
  const auditTrail = await loadAuditTrail(client, periodId);

  const rawPayload = rptRow?.payload ?? null;
  let parsedPayload: unknown = rawPayload;
  if (typeof parsedPayload === "string") {
    try {
      parsedPayload = JSON.parse(parsedPayload);
    } catch {
      parsedPayload = rawPayload;
    }
  }
  let payloadSha256: string | null = null;
  if (parsedPayload !== null && parsedPayload !== undefined) {
    const canonical = canonicalString(parsedPayload);
    payloadSha256 = createHash("sha256").update(canonical).digest("hex");
  }

  return {
    bas_labels: basLabels,
    rpt_payload: rawPayload ?? null,
    rpt_signature: rptRow?.signature ?? null,
    payload_sha256: payloadSha256,
    owa_ledger_deltas: owaLedger,
    bank_receipt_hash: lastLedger?.bank_receipt_hash ?? null,
    anomaly_thresholds: thresholds,
    discrepancy_log: discrepancyLog,
    audit_trail: auditTrail,
  };
}
