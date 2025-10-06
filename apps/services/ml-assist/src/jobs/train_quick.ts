import path from 'node:path';
import fs from 'node:fs/promises';

import { FeatureStore } from '../lib/featureStore';
import { ensureSyntheticFeatures } from '../lib/featureBuilders';
import { ModelRegistry } from '../lib/modelRegistry';
import { trainRidgeRegression } from '../lib/training';
import { buildTrainingSamples, FEATURE_NAMES } from '../lib/dataset';

async function persistTrainingSummary(metadataPath: string, summary: unknown): Promise<void> {
  const dir = path.dirname(metadataPath);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(metadataPath, JSON.stringify(summary, null, 2));
}

async function main() {
  const store = new FeatureStore();
  await store.init();
  await ensureSyntheticFeatures(store);

  const [reconRows, bankRows, liabilityRows] = await Promise.all([
    store.readFeatureSet('recon'),
    store.readFeatureSet('bank'),
    store.readFeatureSet('liability'),
  ]);

  const samples = buildTrainingSamples({
    recon: reconRows,
    bank: bankRows,
    liability: liabilityRows,
  });

  if (!samples.length) {
    throw new Error('No samples available after merging features. Run feature build jobs first.');
  }

  const trainingResult = trainRidgeRegression(samples, FEATURE_NAMES);

  const registry = new ModelRegistry();
  const metadata = await registry.registerModel({
    modelName: 'ml_assist_risk',
    artifact: {
      model: trainingResult.model,
      feature_names: FEATURE_NAMES,
      trained_on: samples.map(({ entity_id, as_of }) => ({ entity_id, as_of })),
    },
    trainingData: samples,
    metrics: trainingResult.metrics,
  });

  await store.close();

  const summaryPath = path.join('apps/services/ml-assist', 'training_summary.json');
  await persistTrainingSummary(summaryPath, {
    model: metadata,
    metrics: trainingResult.metrics,
    samples: samples.length,
  });

  console.log(`Registered model ${metadata.model_name} ${metadata.version}`);
  console.log(`Metrics: ${JSON.stringify(trainingResult.metrics)}`);
  console.log(`Artifact stored at ${metadata.artifact_path}`);
}

main().catch((error) => {
  console.error('Quick training job failed', error);
  process.exitCode = 1;
});
