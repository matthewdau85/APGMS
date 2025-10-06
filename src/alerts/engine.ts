// src/alerts/engine.ts
import { isAnomalous, Thresholds as ReconThresholds } from "../anomaly/deterministic";
import type { AlertCode, AlertSeverity, DashboardAlert } from "./types";

export interface Queryable {
  query<T = any>(text: string, params?: any[]): Promise<{ rows: T[] }>;
}

interface PeriodRow {
  abn: string;
  tax_type: string;
  period_id: string;
  state: string;
  final_liability_cents: number | string | null;
  credited_to_owa_cents: number | string | null;
  anomaly_vector: Record<string, number> | null;
  thresholds: ReconThresholds | null;
}

interface PeriodEventRow {
  abn: string;
  tax_type: string;
  period_id: string;
  event_type: string;
  event_at: string | Date;
}

interface StoredAlertRow {
  id: number;
  abn: string;
  tax_type: string | null;
  period_id: string | null;
  code: AlertCode;
  message: string;
  severity: AlertSeverity;
  details: any;
  detected_at: string;
  acknowledged_at: string | null;
  resolved_at: string | null;
}

interface AlertCandidate {
  code: AlertCode;
  message: string;
  severity: AlertSeverity;
  periodId: string | null;
  taxType: string | null;
  details?: Record<string, unknown>;
}

const ACTIVE_INDEX_SQL = `
CREATE UNIQUE INDEX IF NOT EXISTS ux_dashboard_alerts_active
  ON dashboard_alerts (abn, COALESCE(tax_type, ''), COALESCE(period_id, ''), code)
  WHERE resolved_at IS NULL;
`;

const VISIBLE_INDEX_SQL = `
CREATE INDEX IF NOT EXISTS idx_dashboard_alerts_visible
  ON dashboard_alerts (abn)
  WHERE resolved_at IS NULL AND acknowledged_at IS NULL;
`;

function normalizeCents(value: number | string | null | undefined): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === "number") return value;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function toDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  const ts = Date.parse(value);
  return Number.isNaN(ts) ? null : new Date(ts);
}

function formatCurrency(cents: number): string {
  const dollars = cents / 100;
  return dollars.toLocaleString("en-AU", { style: "currency", currency: "AUD" });
}

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-AU", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export async function ensureAlertsSchema(db: Queryable): Promise<void> {
  await db.query(`
    CREATE TABLE IF NOT EXISTS dashboard_alerts (
      id              BIGSERIAL PRIMARY KEY,
      abn             TEXT        NOT NULL,
      tax_type        TEXT,
      period_id       TEXT,
      code            TEXT        NOT NULL,
      message         TEXT        NOT NULL,
      severity        TEXT        NOT NULL DEFAULT 'warning',
      detected_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
      details         JSONB       NOT NULL DEFAULT '{}'::jsonb,
      acknowledged_at TIMESTAMPTZ,
      resolved_at     TIMESTAMPTZ
    );
  `);
  await db.query(ACTIVE_INDEX_SQL);
  await db.query(VISIBLE_INDEX_SQL);
}

async function fetchPeriods(db: Queryable, abn: string): Promise<PeriodRow[]> {
  const { rows } = await db.query<PeriodRow>(
    `SELECT abn, tax_type, period_id, state, final_liability_cents, credited_to_owa_cents, anomaly_vector, thresholds
     FROM periods
     WHERE abn=$1`,
    [abn]
  );
  return rows;
}

async function fetchEvents(db: Queryable, abn: string): Promise<PeriodEventRow[]> {
  try {
    const { rows } = await db.query<PeriodEventRow>(
      `SELECT abn, tax_type, period_id, event_type, event_at
       FROM period_events
       WHERE abn=$1`,
      [abn]
    );
    return rows;
  } catch (err: any) {
    if (err?.code === "42P01") {
      // period_events table missing; treat as no events
      return [];
    }
    throw err;
  }
}

function groupEvents(rows: PeriodEventRow[]) {
  const map = new Map<string, { dueAt: Date | null; lodgedAt: Date | null }>();
  for (const row of rows) {
    const key = `${row.tax_type}::${row.period_id}`;
    let entry = map.get(key);
    if (!entry) {
      entry = { dueAt: null, lodgedAt: null };
      map.set(key, entry);
    }
    const when = toDate(row.event_at);
    if (!when) continue;
    if (row.event_type === "BAS_DUE") {
      if (!entry.dueAt || entry.dueAt < when) entry.dueAt = when;
    } else if (row.event_type === "BAS_LODGED") {
      if (!entry.lodgedAt || entry.lodgedAt < when) entry.lodgedAt = when;
    }
  }
  return map;
}

function buildAlertCandidates(
  periods: PeriodRow[],
  eventMap: Map<string, { dueAt: Date | null; lodgedAt: Date | null }>,
  now: Date
): AlertCandidate[] {
  const out: AlertCandidate[] = [];
  for (const period of periods) {
    const key = `${period.tax_type}::${period.period_id}`;
    const events = eventMap.get(key) ?? { dueAt: null, lodgedAt: null };
    const dueAt = events.dueAt;
    const lodgedAt = events.lodgedAt;
    const state = period.state ?? "";
    const finalLiability = normalizeCents(period.final_liability_cents);
    const credited = normalizeCents(period.credited_to_owa_cents);

    if (
      dueAt &&
      dueAt.getTime() <= now.getTime() &&
      (!lodgedAt || lodgedAt.getTime() < dueAt.getTime()) &&
      state !== "FINALIZED" &&
      state !== "RELEASED"
    ) {
      out.push({
        code: "OVERDUE_BAS",
        severity: "critical",
        periodId: period.period_id,
        taxType: period.tax_type,
        message: `BAS for ${period.period_id} is overdue since ${formatDate(dueAt)}.`,
        details: {
          dueDate: dueAt.toISOString(),
          lodgedAt: lodgedAt ? lodgedAt.toISOString() : null,
          state,
        },
      });
    }

    if (finalLiability > 0 && credited < finalLiability) {
      const shortfall = finalLiability - credited;
      out.push({
        code: "OWA_SHORTFALL",
        severity: "critical",
        periodId: period.period_id,
        taxType: period.tax_type,
        message: `OWA balance is short by ${formatCurrency(shortfall)} for ${period.period_id}.`,
        details: {
          finalLiabilityCents: finalLiability,
          creditedCents: credited,
          shortfallCents: shortfall,
        },
      });
    }

    const vector = period.anomaly_vector ?? undefined;
    if (vector) {
      const thresholds = period.thresholds ?? {};
      if (isAnomalous(vector as any, thresholds)) {
        out.push({
          code: "RECON_ANOMALY",
          severity: "warning",
          periodId: period.period_id,
          taxType: period.tax_type,
          message: `Reconciliation anomaly detected for ${period.period_id}.`,
          details: {
            anomalyVector: vector,
            thresholds,
          },
        });
      }
    }
  }
  return out;
}

function alertKey(alert: { code: AlertCode; taxType: string | null; periodId: string | null }): string {
  return `${alert.taxType ?? ""}::${alert.periodId ?? ""}::${alert.code}`;
}

function normalizeDetails(details: any): Record<string, unknown> {
  if (!details) return {};
  if (typeof details === "string") {
    try {
      return JSON.parse(details);
    } catch {
      return {};
    }
  }
  return details;
}

export async function refreshAlerts({ pool, abn, now = new Date() }: { pool: Queryable; abn: string; now?: Date }): Promise<void> {
  await ensureAlertsSchema(pool);
  const [periods, events] = await Promise.all([fetchPeriods(pool, abn), fetchEvents(pool, abn)]);
  const eventMap = groupEvents(events);
  const desired = buildAlertCandidates(periods, eventMap, now);

  const existingRes = await pool.query<StoredAlertRow>(
    `SELECT id, abn, tax_type, period_id, code, message, severity, details, detected_at, acknowledged_at, resolved_at
     FROM dashboard_alerts
     WHERE abn=$1 AND resolved_at IS NULL`,
    [abn]
  );
  const existingMap = new Map<string, StoredAlertRow>();
  for (const row of existingRes.rows) {
    existingMap.set(alertKey(row), { ...row, details: normalizeDetails(row.details) });
  }

  for (const candidate of desired) {
    const key = alertKey(candidate);
    const current = existingMap.get(key);
    if (current) {
      const desiredDetails = candidate.details ?? {};
      const existingDetails = normalizeDetails(current.details);
      const detailsChanged = JSON.stringify(existingDetails) !== JSON.stringify(desiredDetails);
      if (current.message !== candidate.message || current.severity !== candidate.severity || detailsChanged) {
        await pool.query(
          `UPDATE dashboard_alerts SET message=$1, severity=$2, details=$3::jsonb WHERE id=$4`,
          [candidate.message, candidate.severity, JSON.stringify(desiredDetails), current.id]
        );
      }
      existingMap.delete(key);
      continue;
    }

    await pool.query(
      `INSERT INTO dashboard_alerts (abn, tax_type, period_id, code, message, severity, detected_at, details)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)` ,
      [
        abn,
        candidate.taxType,
        candidate.periodId,
        candidate.code,
        candidate.message,
        candidate.severity,
        now.toISOString(),
        JSON.stringify(candidate.details ?? {}),
      ]
    );
  }

  for (const row of existingMap.values()) {
    await pool.query(`UPDATE dashboard_alerts SET resolved_at=$1 WHERE id=$2`, [now.toISOString(), row.id]);
  }
}

export async function listActiveAlerts({ pool, abn }: { pool: Queryable; abn: string }): Promise<DashboardAlert[]> {
  await ensureAlertsSchema(pool);
  const { rows } = await pool.query<StoredAlertRow>(
    `SELECT id, abn, tax_type, period_id, code, message, severity, details, detected_at
     FROM dashboard_alerts
     WHERE abn=$1 AND resolved_at IS NULL AND acknowledged_at IS NULL
     ORDER BY detected_at ASC`,
    [abn]
  );

  return rows.map((row) => ({
    id: row.id,
    abn: row.abn,
    taxType: row.tax_type,
    periodId: row.period_id,
    code: row.code,
    message: row.message,
    severity: row.severity,
    detectedAt: row.detected_at,
    details: normalizeDetails(row.details),
  }));
}

export async function acknowledgeAlerts({
  pool,
  abn,
  ids,
  now = new Date(),
}: {
  pool: Queryable;
  abn: string;
  ids: number[];
  now?: Date;
}): Promise<number> {
  if (!ids.length) return 0;
  await ensureAlertsSchema(pool);
  let count = 0;
  const ts = now.toISOString();
  for (const id of ids) {
    const { rows } = await pool.query<{ id: number }>(
      `UPDATE dashboard_alerts
         SET acknowledged_at=$1
       WHERE abn=$2 AND id=$3 AND acknowledged_at IS NULL
       RETURNING id`,
      [ts, abn, id]
    );
    if (rows.length) count += 1;
  }
  return count;
}
