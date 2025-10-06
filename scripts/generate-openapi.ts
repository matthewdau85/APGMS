import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { buildOpenApiSpec } from "./openapi";

function main() {
  const spec = buildOpenApiSpec();
  const outputPath = resolve(process.cwd(), "openapi.json");
  writeFileSync(outputPath, JSON.stringify(spec, null, 2) + "\n");
  console.log(`openapi.json written to ${outputPath}`);
}

main();
