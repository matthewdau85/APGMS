#!/usr/bin/env tsx
import path from "node:path";
import { computeRulesManifest } from "../../apps/services/payments/src/evidence/rulesManifest.js";

async function main() {
  const dir = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve(process.cwd(), "rules");
  const version = process.argv[3];
  const manifest = await computeRulesManifest(dir, version);
  process.stdout.write(JSON.stringify(manifest, null, 2));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

