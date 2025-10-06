export type PeriodPhase = "pre" | "close" | "post";

export interface ReconScoreItemInput {
  id: string;
  delta: number;
  delta_pct: number;
  age_days: number;
  amount: number;
  counterparty_freq: number;
  crn_valid: boolean;
  historical_adjustments: number;
  period_phase: PeriodPhase;
  pay_channel: string;
  retry_count: number;
}

export interface ReconModelNode {
  id: number;
  leaf: boolean;
  value?: number;
  feature?: string;
  threshold?: number;
  left?: number;
  right?: number;
}

export interface ReconModelTree {
  learning_rate: number;
  nodes: ReconModelNode[];
}

export interface ReconModelDefinition {
  model_version: string;
  algorithm: string;
  features: string[];
  encoders: {
    period_phase: Record<string, number>;
    pay_channel: Record<string, number>;
  };
  scaler: {
    mean: number[];
    scale: number[];
  };
  training: {
    data_rows: number;
    positive_rate: number;
    metrics: Record<string, number>;
  };
  gradient_boosting?: {
    base_score: number;
    trees: ReconModelTree[];
  };
  fallback: {
    algorithm: string;
    intercept: number;
    coefficients: Record<string, number>;
  };
}

export interface FeatureVector {
  values: number[];
  mapped: Record<string, number>;
}

export interface FactorContribution {
  feature: string;
  impact: number;
  direction: "positive" | "negative";
  description: string;
}

export interface ReconScoreResult {
  id: string;
  score: number;
  risk_band: "high" | "medium" | "low";
  top_factors: FactorContribution[];
}

export interface ReconScoreResponse {
  model_version: string;
  scored: ReconScoreResult[];
}
