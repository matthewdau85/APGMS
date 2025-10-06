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

const DEFAULT_THRESHOLDS: Required<Thresholds> = {
  variance_ratio: 0.25,
  dup_rate: 0.05,
  gap_minutes: 60,
  delta_vs_baseline: 0.1,
};

function normaliseVector(v: Partial<Record<keyof AnomalyVector, number>>): AnomalyVector {
  return {
    variance_ratio: Number(v.variance_ratio ?? 0),
    dup_rate: Number(v.dup_rate ?? 0),
    gap_minutes: Number(v.gap_minutes ?? 0),
    delta_vs_baseline: Number(v.delta_vs_baseline ?? 0),
  };
}

function normaliseThresholds(thr: Thresholds = {}): Required<Thresholds> {
  return {
    variance_ratio: Number(thr.variance_ratio ?? DEFAULT_THRESHOLDS.variance_ratio),
    dup_rate: Number(thr.dup_rate ?? DEFAULT_THRESHOLDS.dup_rate),
    gap_minutes: Number(thr.gap_minutes ?? DEFAULT_THRESHOLDS.gap_minutes),
    delta_vs_baseline: Number(thr.delta_vs_baseline ?? DEFAULT_THRESHOLDS.delta_vs_baseline),
  };
}

export function exceeds(v: Record<string, number> = {}, thr: Thresholds = {}): boolean {
  const vector = normaliseVector(v as Partial<Record<keyof AnomalyVector, number>>);
  const thresholds = normaliseThresholds(thr);
  return (
    vector.variance_ratio > thresholds.variance_ratio ||
    vector.dup_rate > thresholds.dup_rate ||
    vector.gap_minutes > thresholds.gap_minutes ||
    Math.abs(vector.delta_vs_baseline) > thresholds.delta_vs_baseline
  );
}

export function isAnomalous(v: AnomalyVector, thr: Thresholds = {}): boolean {
  return exceeds(v, thr);
}
