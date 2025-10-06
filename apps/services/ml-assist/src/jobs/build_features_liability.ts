import { FeatureStore } from '../lib/featureStore';
import { buildLiabilityFeatures } from '../lib/featureBuilders';

async function main() {
  const store = new FeatureStore();
  await store.init();
  const rows = await buildLiabilityFeatures(store);
  await store.close();
  console.log(`Wrote ${rows.length} liability feature rows to the feature store.`);
}

main().catch((error) => {
  console.error('Failed to build liability features', error);
  process.exitCode = 1;
});
