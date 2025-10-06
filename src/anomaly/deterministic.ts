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

function resolveThreshold<T extends keyof Thresholds>(thr: Thresholds, key: T, fallback: number): number {
  const raw = thr[key];
  return typeof raw === "number" && Number.isFinite(raw) ? raw : fallback;
}

export function exceeds(v: AnomalyVector, thr: Thresholds = {}): boolean {
  return (
    v.variance_ratio > resolveThreshold(thr, "variance_ratio", 0.25) ||
    v.dup_rate > resolveThreshold(thr, "dup_rate", 0.05) ||
    v.gap_minutes > resolveThreshold(thr, "gap_minutes", 60) ||
    Math.abs(v.delta_vs_baseline) > resolveThreshold(thr, "delta_vs_baseline", 0.1)
  );
}

export function isAnomalous(v: AnomalyVector, thr: Thresholds = {}): boolean {
  return exceeds(v, thr);
}
