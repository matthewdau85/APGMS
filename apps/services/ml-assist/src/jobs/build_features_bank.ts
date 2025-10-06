import { FeatureStore } from '../lib/featureStore';
import { buildBankFeatures } from '../lib/featureBuilders';

async function main() {
  const store = new FeatureStore();
  await store.init();
  const rows = await buildBankFeatures(store);
  await store.close();
  console.log(`Wrote ${rows.length} bank feature rows to the feature store.`);
}

main().catch((error) => {
  console.error('Failed to build bank features', error);
  process.exitCode = 1;
});
