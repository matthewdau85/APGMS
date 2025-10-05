export interface AnomalyVector {
  variance_ratio: number;
  dup_rate: number;
  gap_minutes: number;
  delta_vs_baseline: number;
}

export interface Thresholds {
  variance_ratio?: number;
  dup_rate?: number;
  gap_minutes?: number;
  delta_vs_baseline?: number;
}

export function isAnomalous(v: AnomalyVector, thr: Thresholds = {}): boolean {
  return (
    v.variance_ratio > (thr.variance_ratio ?? 0.25) ||
    v.dup_rate > (thr.dup_rate ?? 0.05) ||
    v.gap_minutes > (thr.gap_minutes ?? 60) ||
    Math.abs(v.delta_vs_baseline) > (thr.delta_vs_baseline ?? 0.1)
  );
}

function coerceNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function coerceOptionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function exceeds(
  vector: Partial<AnomalyVector> = {},
  thresholds: Partial<Thresholds> | Record<string, number> = {}
): boolean {
  const normalizedVector: AnomalyVector = {
    variance_ratio: coerceNumber(vector.variance_ratio),
    dup_rate: coerceNumber(vector.dup_rate),
    gap_minutes: coerceNumber(vector.gap_minutes),
    delta_vs_baseline: coerceNumber(vector.delta_vs_baseline),
  };

  const normalizedThresholds: Thresholds = {
    variance_ratio: coerceOptionalNumber((thresholds as Record<string, unknown>).variance_ratio),
    dup_rate: coerceOptionalNumber((thresholds as Record<string, unknown>).dup_rate),
    gap_minutes: coerceOptionalNumber((thresholds as Record<string, unknown>).gap_minutes),
    delta_vs_baseline: coerceOptionalNumber((thresholds as Record<string, unknown>).delta_vs_baseline),
  };

  return isAnomalous(normalizedVector, normalizedThresholds);
}
