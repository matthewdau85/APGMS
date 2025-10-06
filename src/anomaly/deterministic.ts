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
  epsilon_cents?: number;
}

export function exceeds(vector: Partial<AnomalyVector>, thresholds: Thresholds = {}): boolean {
  const v = {
    variance_ratio: vector.variance_ratio ?? 0,
    dup_rate: vector.dup_rate ?? 0,
    gap_minutes: vector.gap_minutes ?? 0,
    delta_vs_baseline: vector.delta_vs_baseline ?? 0,
  };

  return (
    v.variance_ratio > (thresholds.variance_ratio ?? 0.25) ||
    v.dup_rate > (thresholds.dup_rate ?? 0.05) ||
    v.gap_minutes > (thresholds.gap_minutes ?? 60) ||
    Math.abs(v.delta_vs_baseline) > (thresholds.delta_vs_baseline ?? 0.1)
  );
}

export function isAnomalous(v: AnomalyVector, thr: Thresholds = {}): boolean {
  return exceeds(v, thr);
}
