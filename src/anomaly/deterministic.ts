/**
 * Deterministic anomaly vectors encode proportional or time based deviations.
 * Threshold inputs are expected to be expressed as:
 *   - variance_ratio: unit-less ratio (e.g. 0.25 == 25% spread vs baseline)
 *   - dup_rate: unit-less ratio of duplicates observed (0.01 == 1%)
 *   - gap_minutes: whole minutes between successive lodgements
 *   - delta_vs_baseline: absolute ratio difference vs historical baseline
 */
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

export type AnomalyVectorLike = Partial<AnomalyVector>;

export function exceeds(v: AnomalyVectorLike, thr: Thresholds = {}): boolean {
  const thresholds = { ...DEFAULT_THRESHOLDS, ...thr };
  return (
    (v.variance_ratio ?? 0) > thresholds.variance_ratio ||
    (v.dup_rate ?? 0) > thresholds.dup_rate ||
    (v.gap_minutes ?? 0) > thresholds.gap_minutes ||
    Math.abs(v.delta_vs_baseline ?? 0) > thresholds.delta_vs_baseline
  );
}

export function isAnomalous(v: AnomalyVector, thr: Thresholds = {}): boolean {
  return exceeds(v, thr);
}
