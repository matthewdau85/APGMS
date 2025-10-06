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

export interface AnomalyEvaluation {
  anomalous: boolean;
  triggers: string[];
}

export interface AnomalyProvider {
  evaluate(vector: Partial<AnomalyVector>, thresholds?: Thresholds): Promise<AnomalyEvaluation>;
}

export class AnomalyProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnomalyProviderError";
  }
}
