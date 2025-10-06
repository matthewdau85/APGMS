import { TrainingSample } from './training';

export interface FeatureSetRow {
  entity_id: string;
  as_of: string;
  features: Record<string, number>;
}

export interface CombinedRow {
  entity_id: string;
  as_of: string;
  recon?: Record<string, number>;
  bank?: Record<string, number>;
  liability?: Record<string, number>;
}

export const FEATURE_NAMES = [
  'mismatch_amount',
  'daily_transactions',
  'dispute_ratio',
  'avg_balance',
  'cash_inflow',
  'cash_outflow',
  'short_term_debt',
  'long_term_debt',
  'credit_utilization',
  'liquidity_ratio',
  'stress_ratio',
  'engineered_risk_score',
];

export function mergeFeatureSets(featureSets: Record<string, FeatureSetRow[]>): CombinedRow[] {
  const merged = new Map<string, CombinedRow>();
  const keys = Object.keys(featureSets) as Array<keyof typeof featureSets>;

  for (const featureSet of keys) {
    const rows = featureSets[featureSet] ?? [];
    for (const row of rows) {
      const key = `${row.entity_id}__${row.as_of}`;
      const entry = merged.get(key) ?? { entity_id: row.entity_id, as_of: row.as_of };
      (entry as Record<string, unknown>)[featureSet] = row.features;
      merged.set(key, entry);
    }
  }

  return Array.from(merged.values());
}

export function computeTrainingSample(row: CombinedRow): TrainingSample | null {
  if (!row.recon || !row.bank || !row.liability) return null;

  const liquidityRatio = (row.bank.avg_balance + row.bank.cash_inflow) / (row.liability.short_term_debt + 1);
  const stressRatio = row.recon.mismatch_amount / (row.bank.cash_outflow + 1);

  const riskScore =
    stressRatio * 1.8 + row.liability.credit_utilization * 1.5 - liquidityRatio * 0.4 + row.recon.dispute_ratio * 2;
  const label = riskScore > 0 ? 1 : 0;

  const features: Record<string, number> = {
    mismatch_amount: row.recon.mismatch_amount,
    daily_transactions: row.recon.daily_transactions,
    dispute_ratio: row.recon.dispute_ratio,
    avg_balance: row.bank.avg_balance,
    cash_inflow: row.bank.cash_inflow,
    cash_outflow: row.bank.cash_outflow,
    short_term_debt: row.liability.short_term_debt,
    long_term_debt: row.liability.long_term_debt,
    credit_utilization: row.liability.credit_utilization,
    liquidity_ratio: Number(liquidityRatio.toFixed(6)),
    stress_ratio: Number(stressRatio.toFixed(6)),
    engineered_risk_score: Number(riskScore.toFixed(6)),
  };

  return {
    entity_id: row.entity_id,
    as_of: row.as_of,
    features,
    label,
  };
}

export function buildTrainingSamples(featureSets: Record<string, FeatureSetRow[]>): TrainingSample[] {
  const combined = mergeFeatureSets(featureSets);
  return combined
    .map((row) => computeTrainingSample(row))
    .filter((sample): sample is TrainingSample => Boolean(sample));
}
