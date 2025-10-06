import { FeatureRow, FeatureStore } from './featureStore';

const AS_OF_DATE = '2024-10-01T00:00:00.000Z';

type FeatureBuilder = (store: FeatureStore) => Promise<FeatureRow[]>;

function baseRows(): Array<Omit<FeatureRow, 'features'>> {
  return [
    { entity_id: 'acct-100', as_of: AS_OF_DATE },
    { entity_id: 'acct-200', as_of: AS_OF_DATE },
    { entity_id: 'acct-300', as_of: AS_OF_DATE },
    { entity_id: 'acct-400', as_of: AS_OF_DATE },
  ];
}

function writeFeatureSet(store: FeatureStore, featureSet: string, rows: FeatureRow[]): Promise<void> {
  return store.upsertFeatureSet(featureSet, rows);
}

export const buildReconFeatures: FeatureBuilder = async (store) => {
  const rows: FeatureRow[] = baseRows().map((row, index) => ({
    ...row,
    features: {
      mismatch_amount: [1500, 500, 2500, 800][index],
      daily_transactions: [85, 40, 95, 60][index],
      dispute_ratio: [0.12, 0.05, 0.18, 0.08][index],
    },
  }));
  await writeFeatureSet(store, 'recon', rows);
  return rows;
};

export const buildBankFeatures: FeatureBuilder = async (store) => {
  const rows: FeatureRow[] = baseRows().map((row, index) => ({
    ...row,
    features: {
      avg_balance: [25000, 48000, 18000, 52000][index],
      cash_inflow: [12000, 15000, 9000, 18000][index],
      cash_outflow: [9000, 12000, 11000, 10000][index],
    },
  }));
  await writeFeatureSet(store, 'bank', rows);
  return rows;
};

export const buildLiabilityFeatures: FeatureBuilder = async (store) => {
  const rows: FeatureRow[] = baseRows().map((row, index) => ({
    ...row,
    features: {
      short_term_debt: [14000, 15000, 21000, 12000][index],
      long_term_debt: [35000, 22000, 48000, 20000][index],
      credit_utilization: [0.72, 0.45, 0.88, 0.51][index],
    },
  }));
  await writeFeatureSet(store, 'liability', rows);
  return rows;
};

export async function ensureSyntheticFeatures(store: FeatureStore): Promise<void> {
  const featureSets = await store.listFeatureSets();
  if (!featureSets.includes('recon')) {
    await buildReconFeatures(store);
  }
  if (!featureSets.includes('bank')) {
    await buildBankFeatures(store);
  }
  if (!featureSets.includes('liability')) {
    await buildLiabilityFeatures(store);
  }
}
