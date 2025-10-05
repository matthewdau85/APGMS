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

export function exceeds(
  v: Partial<AnomalyVector> | null | undefined,
  thr: Thresholds = {}
): boolean {
  if (!v) return false;

  const varianceRatio = v.variance_ratio ?? 0;
  const dupRate = v.dup_rate ?? 0;
  const gapMinutes = v.gap_minutes ?? 0;
  const deltaVsBaseline = v.delta_vs_baseline ?? 0;

  return (
    varianceRatio > (thr.variance_ratio ?? 0.25) ||
    dupRate > (thr.dup_rate ?? 0.05) ||
    gapMinutes > (thr.gap_minutes ?? 60) ||
    Math.abs(deltaVsBaseline) > (thr.delta_vs_baseline ?? 0.1)
  );
}
