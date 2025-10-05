export interface AnomalyVector {
  variance_ratio: number;
  dup_rate: number;
  gap_minutes: number;
  delta_vs_baseline: number;
}

export interface Thresholds {
  variance_ratio: number;
  dup_rate: number;
  gap_minutes: number;
  delta_vs_baseline: number;
}

export type ThresholdOverrides = Partial<Record<keyof Thresholds, number>>;

export type AnomalyDecision = "CLEAR" | "NEAR" | "BLOCK";

export interface AnomalyAssessment {
  decision: AnomalyDecision;
  breaches: string[];
  near: string[];
  vector: AnomalyVector;
  thresholds: Thresholds;
}

export interface AnomalyPort {
  evaluate(vector: AnomalyVector, overrides?: ThresholdOverrides): Promise<AnomalyAssessment>;
}

export const defaultThresholds: Thresholds = {
  variance_ratio: 0.25,
  dup_rate: 0.05,
  gap_minutes: 60,
  delta_vs_baseline: 0.1,
};

export function resolveThresholds(overrides: ThresholdOverrides = {}): Thresholds {
  return {
    variance_ratio: overrides.variance_ratio ?? defaultThresholds.variance_ratio,
    dup_rate: overrides.dup_rate ?? defaultThresholds.dup_rate,
    gap_minutes: overrides.gap_minutes ?? defaultThresholds.gap_minutes,
    delta_vs_baseline: overrides.delta_vs_baseline ?? defaultThresholds.delta_vs_baseline,
  };
}

export function sanitizeVector(vector: Partial<AnomalyVector> | null | undefined): AnomalyVector {
  return {
    variance_ratio: Number(vector?.variance_ratio ?? 0),
    dup_rate: Number(vector?.dup_rate ?? 0),
    gap_minutes: Number(vector?.gap_minutes ?? 0),
    delta_vs_baseline: Number(vector?.delta_vs_baseline ?? 0),
  };
}
