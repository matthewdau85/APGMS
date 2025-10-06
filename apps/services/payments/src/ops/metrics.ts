// apps/services/payments/src/ops/metrics.ts
import type { Pool } from "pg";

export interface SloSnapshot {
  p95ReleaseMs: number;
  releaseErrorRate: number;
  dlqDepth: number;
  reconLagSec: number;
}

const HISTOGRAM_BUCKETS = [50, 100, 250, 500, 1000, 2000, 5000, 10000];

const histogramCounts = HISTOGRAM_BUCKETS.map(() => 0);
let histogramCount = 0;
let histogramSum = 0;

let releaseAttempts = 0;
let releaseErrors = 0;
const errorCodeCounts = new Map<string, number>();

const durationWindow: number[] = [];
const MAX_WINDOW = 512;

let currentDlqDepth = 0;
let currentReconLag = 0;

const METRICS_CONTENT_TYPE = "text/plain; version=0.0.4";

function sanitiseLabel(value: string): string {
  return value.replace(/"/g, "\"");
}

function observeHistogram(durationMs: number) {
  histogramCount += 1;
  histogramSum += durationMs;
  for (let i = 0; i < HISTOGRAM_BUCKETS.length; i += 1) {
    if (durationMs <= HISTOGRAM_BUCKETS[i]) {
      histogramCounts[i] += 1;
    }
  }
}

function computePercentile(values: readonly number[], percentile: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(percentile * sorted.length) - 1));
  return sorted[idx];
}

function renderHistogramLines(): string[] {
  const lines: string[] = ["# TYPE apgms_release_duration_ms histogram"];
  let cumulative = 0;
  for (let i = 0; i < HISTOGRAM_BUCKETS.length; i += 1) {
    cumulative += histogramCounts[i];
    lines.push(
      `apgms_release_duration_ms_bucket{le="${HISTOGRAM_BUCKETS[i]}"} ${cumulative}`
    );
  }
  lines.push(`apgms_release_duration_ms_bucket{le="+Inf"} ${histogramCount}`);
  lines.push(`apgms_release_duration_ms_sum ${histogramSum.toFixed(3)}`);
  lines.push(`apgms_release_duration_ms_count ${histogramCount}`);
  return lines;
}

function renderAttemptLines(): string[] {
  return [
    "# TYPE apgms_release_attempts_total counter",
    `apgms_release_attempts_total ${releaseAttempts}`,
    "# TYPE apgms_release_errors_total counter",
    `apgms_release_errors_total ${releaseErrors}`,
  ];
}

function renderErrorCodeLines(): string[] {
  const lines: string[] = [];
  if (!errorCodeCounts.size) return lines;
  lines.push("# TYPE apgms_release_error_by_code counter");
  for (const [code, count] of errorCodeCounts.entries()) {
    lines.push(`apgms_release_error_by_code{code="${sanitiseLabel(code)}"} ${count}`);
  }
  return lines;
}

function renderGaugeLines(): string[] {
  return [
    "# TYPE apgms_recon_dlq_depth gauge",
    `apgms_recon_dlq_depth ${currentDlqDepth}`,
    "# TYPE apgms_recon_lag_seconds gauge",
    `apgms_recon_lag_seconds ${currentReconLag.toFixed(3)}`,
  ];
}

export function recordReleaseAttempt(durationMs: number, success: boolean, errorCode?: string) {
  const value = Number.isFinite(durationMs) ? durationMs : 0;
  observeHistogram(value);

  durationWindow.push(value);
  if (durationWindow.length > MAX_WINDOW) durationWindow.shift();

  releaseAttempts += 1;
  if (!success) {
    releaseErrors += 1;
    const key = String(errorCode ?? 'UNKNOWN').toUpperCase();
    errorCodeCounts.set(key, (errorCodeCounts.get(key) ?? 0) + 1);
  }
}

export function setDlqDepth(depth: number) {
  if (!Number.isFinite(depth) || depth < 0) {
    currentDlqDepth = 0;
  } else {
    currentDlqDepth = Math.floor(depth);
  }
}

export function setReconLag(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) {
    currentReconLag = 0;
  } else {
    currentReconLag = seconds;
  }
}

export function getSloSnapshot(): SloSnapshot {
  const p95 = computePercentile(durationWindow, 0.95);
  const rate = releaseAttempts === 0 ? 0 : releaseErrors / releaseAttempts;
  return {
    p95ReleaseMs: Number(p95.toFixed(3)),
    releaseErrorRate: Number(rate.toFixed(4)),
    dlqDepth: currentDlqDepth,
    reconLagSec: Number(currentReconLag.toFixed(3)),
  };
}

export function renderMetrics(): string {
  const parts: string[] = [];
  parts.push(...renderHistogramLines());
  parts.push(...renderAttemptLines());
  parts.push(...renderErrorCodeLines());
  parts.push(...renderGaugeLines());
  return parts.join("\n") + "\n";
}

async function updateDlqFromDb(pool: Pool) {
  try {
    const { rows } = await pool.query<{ cnt: string | number }>(
      `SELECT COUNT(*) AS cnt FROM periods WHERE state IN ('BLOCKED_DISCREPANCY','BLOCKED_ANOMALY','BLOCKED')`
    );
    const raw = rows[0]?.cnt ?? 0;
    const depth = typeof raw === "number" ? raw : Number(raw);
    setDlqDepth(Number.isFinite(depth) ? depth : 0);
  } catch (err) {
    console.warn("[ops] failed to refresh dlq depth", err);
  }
}

async function updateReconLagFromDb(pool: Pool) {
  try {
    const { rows } = await pool.query<{ lag_sec: number | string | null }>(
      `SELECT EXTRACT(EPOCH FROM (NOW() - MAX(created_at))) AS lag_sec FROM owa_ledger`
    );
    const raw = rows[0]?.lag_sec;
    if (raw == null) {
      setReconLag(0);
      return;
    }
    const seconds = typeof raw === "number" ? raw : Number(raw);
    setReconLag(Number.isFinite(seconds) ? Math.max(0, seconds) : 0);
  } catch (err) {
    console.warn("[ops] failed to refresh recon lag", err);
  }
}

export function startOpsCollectors(pool: Pool, intervalMs = 15000) {
  async function refresh() {
    await Promise.all([updateDlqFromDb(pool), updateReconLagFromDb(pool)]);
  }

  refresh().catch((err) => console.warn("[ops] initial metrics refresh failed", err));
  const handle = setInterval(() => {
    refresh().catch((err) => console.warn("[ops] metrics refresh failed", err));
  }, intervalMs);
  if (typeof handle.unref === "function") handle.unref();
}

export function metricsContentType(): string {
  return METRICS_CONTENT_TYPE;
}
