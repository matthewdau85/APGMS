// tests/alerts/alerts_engine.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { acknowledgeAlerts, listActiveAlerts, refreshAlerts, type Queryable } from "../../src/alerts/engine";
import type { DashboardAlert } from "../../src/alerts/types";

type PeriodRecord = {
  abn: string;
  tax_type: string;
  period_id: string;
  state: string;
  final_liability_cents: number;
  credited_to_owa_cents: number;
  anomaly_vector?: Record<string, number>;
  thresholds?: Record<string, number>;
};

type PeriodEventRecord = {
  abn: string;
  tax_type: string;
  period_id: string;
  event_type: string;
  event_at: Date;
};

type AlertRecord = {
  id: number;
  abn: string;
  tax_type: string | null;
  period_id: string | null;
  code: string;
  message: string;
  severity: string;
  details: Record<string, unknown>;
  detected_at: string;
  acknowledged_at: string | null;
  resolved_at: string | null;
};

class InMemoryPool implements Queryable {
  private periods: PeriodRecord[] = [];
  private periodEvents: PeriodEventRecord[] = [];
  private alerts: AlertRecord[] = [];
  private nextAlertId = 1;

  reset() {
    this.periods = [];
    this.periodEvents = [];
    this.alerts = [];
    this.nextAlertId = 1;
  }

  insertPeriod(record: PeriodRecord) {
    this.periods.push({ ...record });
  }

  updatePeriod(abn: string, taxType: string, periodId: string, updates: Partial<PeriodRecord>) {
    const row = this.periods.find(
      (p) => p.abn === abn && p.tax_type === taxType && p.period_id === periodId
    );
    if (row) {
      Object.assign(row, updates);
    }
  }

  insertEvent(record: PeriodEventRecord) {
    this.periodEvents.push({ ...record });
  }

  private normalize(sql: string): string {
    return sql.trim().replace(/\s+/g, " ").toLowerCase();
  }

  async query<T = any>(sql: string, params: any[] = []): Promise<{ rows: T[] }> {
    const normalized = this.normalize(sql);

    if (normalized.startsWith("create table if not exists dashboard_alerts")) {
      return { rows: [] as T[] };
    }
    if (normalized.startsWith("create unique index if not exists ux_dashboard_alerts_active")) {
      return { rows: [] as T[] };
    }
    if (normalized.startsWith("create index if not exists idx_dashboard_alerts_visible")) {
      return { rows: [] as T[] };
    }

    if (normalized.startsWith("select abn, tax_type, period_id, state")) {
      const abn = params[0];
      const rows = this.periods
        .filter((p) => p.abn === abn)
        .map((p) => ({
          ...p,
          anomaly_vector: p.anomaly_vector ?? null,
          thresholds: p.thresholds ?? null,
        }));
      return { rows: rows as T[] };
    }

    if (normalized.startsWith("select abn, tax_type, period_id, event_type")) {
      const abn = params[0];
      const rows = this.periodEvents
        .filter((e) => e.abn === abn)
        .map((e) => ({
          ...e,
          event_at: e.event_at,
        }));
      return { rows: rows as T[] };
    }

    if (normalized.startsWith("select id, abn, tax_type, period_id, code, message, severity, details, detected_at, acknowledged_at, resolved_at from dashboard_alerts")) {
      const abn = params[0];
      const rows = this.alerts
        .filter((a) => a.abn === abn && a.resolved_at === null)
        .map((a) => ({ ...a }));
      return { rows: rows as T[] };
    }

    if (normalized.startsWith("update dashboard_alerts set message=$1, severity=$2, details=$3::jsonb where id=$4")) {
      const [message, severity, detailsJson, id] = params;
      const row = this.alerts.find((a) => a.id === id);
      if (row) {
        row.message = message;
        row.severity = severity;
        try {
          row.details = detailsJson ? JSON.parse(detailsJson) : {};
        } catch {
          row.details = {};
        }
      }
      return { rows: [] as T[] };
    }

    if (normalized.startsWith("insert into dashboard_alerts")) {
      const [abn, taxType, periodId, code, message, severity, detectedAt, detailsJson] = params;
      const record: AlertRecord = {
        id: this.nextAlertId++,
        abn,
        tax_type: taxType ?? null,
        period_id: periodId ?? null,
        code,
        message,
        severity,
        detected_at: detectedAt,
        acknowledged_at: null,
        resolved_at: null,
        details: {},
      };
      try {
        record.details = detailsJson ? JSON.parse(detailsJson) : {};
      } catch {
        record.details = {};
      }
      this.alerts.push(record);
      return { rows: [{ id: record.id }] as T[] };
    }

    if (normalized.startsWith("update dashboard_alerts set resolved_at=$1 where id=$2")) {
      const [resolvedAt, id] = params;
      const row = this.alerts.find((a) => a.id === id);
      if (row) {
        row.resolved_at = resolvedAt;
      }
      return { rows: [] as T[] };
    }

    if (normalized.startsWith("select id, abn, tax_type, period_id, code, message, severity, details, detected_at from dashboard_alerts")) {
      const abn = params[0];
      const rows = this.alerts
        .filter((a) => a.abn === abn && a.resolved_at === null && a.acknowledged_at === null)
        .sort((a, b) => a.detected_at.localeCompare(b.detected_at))
        .map((a) => ({ ...a }));
      return { rows: rows as T[] };
    }

    if (normalized.startsWith("update dashboard_alerts set acknowledged_at=$1 where abn=$2 and id=$3 and acknowledged_at is null returning id")) {
      const [ts, abn, id] = params;
      const row = this.alerts.find((a) => a.id === id && a.abn === abn && a.acknowledged_at === null);
      if (row) {
        row.acknowledged_at = ts;
        return { rows: [{ id: row.id }] as T[] };
      }
      return { rows: [] as T[] };
    }

    throw new Error(`Unsupported SQL: ${sql}`);
  }
}

const pool = new InMemoryPool();

function shortfallAlert(alerts: DashboardAlert[]) {
  return alerts.find((a) => a.code === "OWA_SHORTFALL");
}

function overdueAlert(alerts: DashboardAlert[]) {
  return alerts.find((a) => a.code === "OVERDUE_BAS");
}

function anomalyAlert(alerts: DashboardAlert[]) {
  return alerts.find((a) => a.code === "RECON_ANOMALY");
}

test("derives overdue and shortfall alerts from periods and events", async () => {
  pool.reset();
  pool.insertPeriod({
    abn: "123",
    tax_type: "GST",
    period_id: "2025-Q1",
    state: "OPEN",
    final_liability_cents: 50000,
    credited_to_owa_cents: 20000,
    anomaly_vector: { variance_ratio: 0.1, dup_rate: 0.01, gap_minutes: 5, delta_vs_baseline: 0.02 },
    thresholds: {},
  });
  pool.insertEvent({
    abn: "123",
    tax_type: "GST",
    period_id: "2025-Q1",
    event_type: "BAS_DUE",
    event_at: new Date("2025-04-28T00:00:00Z"),
  });

  await refreshAlerts({ pool, abn: "123", now: new Date("2025-06-01T00:00:00Z") });
  const alerts = await listActiveAlerts({ pool, abn: "123" });
  assert.equal(alerts.length, 2);
  assert.ok(shortfallAlert(alerts));
  const overdue = overdueAlert(alerts);
  assert.ok(overdue);
  assert.match(String((overdue!.details as any).dueDate ?? ""), /2025/);
});

test("acknowledging hides alerts until the condition changes", async () => {
  pool.reset();
  pool.insertPeriod({
    abn: "123",
    tax_type: "GST",
    period_id: "2025-Q2",
    state: "OPEN",
    final_liability_cents: 80000,
    credited_to_owa_cents: 20000,
    anomaly_vector: { variance_ratio: 0.1, dup_rate: 0.01, gap_minutes: 5, delta_vs_baseline: 0.02 },
    thresholds: {},
  });
  pool.insertEvent({
    abn: "123",
    tax_type: "GST",
    period_id: "2025-Q2",
    event_type: "BAS_DUE",
    event_at: new Date("2025-07-28T00:00:00Z"),
  });

  await refreshAlerts({ pool, abn: "123", now: new Date("2025-08-01T00:00:00Z") });
  let alerts = await listActiveAlerts({ pool, abn: "123" });
  const shortfall = shortfallAlert(alerts);
  assert.ok(shortfall);

  await acknowledgeAlerts({ pool, abn: "123", ids: [shortfall!.id], now: new Date("2025-08-02T00:00:00Z") });
  alerts = await listActiveAlerts({ pool, abn: "123" });
  assert.ok(!shortfallAlert(alerts));

  pool.updatePeriod("123", "GST", "2025-Q2", { credited_to_owa_cents: 80000 });
  await refreshAlerts({ pool, abn: "123", now: new Date("2025-08-05T00:00:00Z") });
  alerts = await listActiveAlerts({ pool, abn: "123" });
  assert.ok(!shortfallAlert(alerts));

  pool.updatePeriod("123", "GST", "2025-Q2", { credited_to_owa_cents: 10000 });
  await refreshAlerts({ pool, abn: "123", now: new Date("2025-08-10T00:00:00Z") });
  alerts = await listActiveAlerts({ pool, abn: "123" });
  const resurfaced = shortfallAlert(alerts);
  assert.ok(resurfaced);
  assert.notEqual(resurfaced!.id, shortfall!.id);
});

test("reconciliation anomalies surface as alerts", async () => {
  pool.reset();
  pool.insertPeriod({
    abn: "555",
    tax_type: "PAYGW",
    period_id: "2025-Q3",
    state: "OPEN",
    final_liability_cents: 0,
    credited_to_owa_cents: 0,
    anomaly_vector: { variance_ratio: 0.6, dup_rate: 0.02, gap_minutes: 10, delta_vs_baseline: 0.15 },
    thresholds: { variance_ratio: 0.3 },
  });

  await refreshAlerts({ pool, abn: "555", now: new Date("2025-09-15T00:00:00Z") });
  const alerts = await listActiveAlerts({ pool, abn: "555" });
  const anomaly = anomalyAlert(alerts);
  assert.ok(anomaly);
  assert.equal(anomaly!.severity, "warning");
});
