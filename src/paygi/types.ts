export type PaygiMethod = "rate" | "amount";

export interface QuarterRule {
  year: string;
  quarter: string;
  instalment_rate: number;
  gdp_uplift: number;
  base_notice_amount?: number;
  notes?: string;
}

export interface VariationReason {
  code: string;
  label: string;
  predicate: string;
  hint: string;
}

export interface VariationConfig {
  reasons: VariationReason[];
  safeHarbour: {
    min_ratio: number;
    max_reduction: number;
    pass_reason: string;
    fail_reason: string;
    calculation_hint?: string;
  };
}

export interface SafeHarbourOutcome {
  passed: boolean;
  ratio: number;
  reduction: number;
  minRatio: number;
  maxReduction: number;
  message: string;
}

export interface PaygiCalculationInput {
  abn: string;
  year: string;
  quarter: string | number;
  method: PaygiMethod;
  incomeBase: number;
  noticeAmount?: number;
  variationAmount?: number;
  reasonCode?: string;
  notes?: string;
}

export interface PaygiQuarterResult {
  period: string;
  method: PaygiMethod;
  t1: number;
  t2: number;
  t3: number;
  t4: number;
  baseT4: number;
  instalmentRate: number;
  gdpUplift: number;
  noticeAmount?: number;
  safeHarbour?: SafeHarbourOutcome;
  evidence?: QuarterEvidence;
}

export interface QuarterEvidence {
  reasonCode?: string;
  reasonLabel?: string;
  notes?: string;
  hint?: string;
}

export interface PaygiSummary {
  quarters: PaygiQuarterResult[];
  segments: EvidenceSegment[];
  notices: Record<string, number>;
}

export interface EvidenceSegment {
  method: PaygiMethod;
  from: string;
  to: string;
  quarters: string[];
  evidence: QuarterEvidence[];
}
