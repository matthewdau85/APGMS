import { testReleaseIdempotency } from "./e2e/release_idempotency.test";
import { testReconImportEvidence } from "./e2e/recon_import_evidence.test";

async function main() {
  await testReleaseIdempotency();
  await testReconImportEvidence();
  console.log("e2e tests completed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
