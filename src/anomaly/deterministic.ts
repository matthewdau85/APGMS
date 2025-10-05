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
  if (!v) return false;
  const variance = Number((v as any).variance_ratio ?? 0);
  if (variance > Number(thr.variance_ratio ?? 0)) return true;
  const dup = Number((v as any).dup_rate ?? 0);
  if (dup > Number(thr.dup_rate ?? 0)) return true;
  const gap = Number((v as any).gap_minutes ?? 0);
  if (gap > Number(thr.gap_minutes ?? 0)) return true;
  const delta = Number((v as any).delta_vs_baseline ?? 0);
  if (Math.abs(delta) > Number(thr.delta_vs_baseline ?? 0)) return true;
  return false;
}
