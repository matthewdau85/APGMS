import { FeatureStore } from '../lib/featureStore';
import { buildReconFeatures } from '../lib/featureBuilders';

async function main() {
  const store = new FeatureStore();
  await store.init();
  const rows = await buildReconFeatures(store);
  await store.close();
  console.log(`Wrote ${rows.length} recon feature rows to the feature store.`);
}

main().catch((error) => {
  console.error('Failed to build recon features', error);
  process.exitCode = 1;
});
