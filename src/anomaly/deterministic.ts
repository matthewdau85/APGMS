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

export function exceeds(v: Partial<AnomalyVector> = {}, thr: Record<string, number> = {}): boolean {
  const variance = Number(v.variance_ratio ?? 0);
  const dup = Number(v.dup_rate ?? 0);
  const gap = Number(v.gap_minutes ?? 0);
  const delta = Number(v.delta_vs_baseline ?? 0);
  return (
    variance > (thr["variance_ratio"] ?? 0.25) ||
    dup > (thr["dup_rate"] ?? 0.01) ||
    gap > (thr["gap_minutes"] ?? 60) ||
    Math.abs(delta) > (thr["delta_vs_baseline"] ?? 0.2)
  );
}
