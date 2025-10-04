export interface AnomalyVector { variance_ratio: number; dup_rate: number; gap_minutes: number; delta_vs_baseline: number; }

export function exceeds(v: AnomalyVector, thr: Record<string, number>): boolean {
  return (v.variance_ratio > (thr[""variance_ratio""] ?? 0.25)) ||
         (v.dup_rate > (thr[""dup_rate""] ?? 0.01)) ||
         (v.gap_minutes > (thr[""gap_minutes""] ?? 60)) ||
         (Math.abs(v.delta_vs_baseline) > (thr[""delta_vs_baseline""] ?? 0.2));
}
