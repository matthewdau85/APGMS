import { promises as fs } from "fs";
import path from "path";

const SPEC_PATH = path.resolve(process.cwd(), "schema/openapi/merged.json");

interface OpenApiDocument {
  openapi: string;
  info?: Record<string, unknown>;
  paths: Record<string, Record<string, unknown>>;
  [key: string]: unknown;
}

function sortObject<T>(obj: Record<string, T>): Record<string, T> {
  return Object.keys(obj)
    .sort((a, b) => a.localeCompare(b))
    .reduce<Record<string, T>>((acc, key) => {
      acc[key] = obj[key];
      return acc;
    }, {});
}

async function main() {
  try {
    await fs.access(SPEC_PATH);
  } catch (err) {
    console.error(`[openapi] Spec file missing at ${SPEC_PATH}`);
    process.exitCode = 1;
    return;
  }

  const raw = await fs.readFile(SPEC_PATH, "utf8");
  let spec: OpenApiDocument;
  try {
    spec = JSON.parse(raw);
  } catch (err) {
    console.error(`[openapi] Failed to parse spec JSON: ${(err as Error).message}`);
    process.exitCode = 1;
    return;
  }

  if (!spec.openapi || typeof spec.openapi !== "string") {
    console.error(`[openapi] Spec missing required 'openapi' version string.`);
    process.exitCode = 1;
    return;
  }
  if (!spec.paths || typeof spec.paths !== "object") {
    console.error(`[openapi] Spec missing 'paths' definition.`);
    process.exitCode = 1;
    return;
  }

  const sortedPaths: Record<string, Record<string, unknown>> = {};
  for (const [route, operations] of Object.entries(sortObject(spec.paths))) {
    sortedPaths[route] = sortObject(operations);
  }

  const normalized: OpenApiDocument = {
    ...spec,
    paths: sortedPaths,
  };

  await fs.writeFile(SPEC_PATH, JSON.stringify(normalized, null, 2) + "\n");
  console.log(`[openapi] Normalized spec with ${Object.keys(sortedPaths).length} path(s).`);
}

main().catch((err) => {
  console.error(`[openapi] Failed:`, err);
  process.exitCode = 1;
});
