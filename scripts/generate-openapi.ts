import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

function mergeComponents(...components: Array<Record<string, any> | undefined>) {
  const result: Record<string, any> = {};
  for (const comp of components) {
    if (!comp) continue;
    for (const [key, value] of Object.entries(comp)) {
      if (!result[key]) {
        result[key] = { ...value };
        continue;
      }
      const target = result[key];
      for (const [innerKey, innerValue] of Object.entries(value as Record<string, any>)) {
        if (innerValue === undefined) continue;
        target[innerKey] = { ...(target[innerKey] ?? {}), ...(innerValue as Record<string, any>) };
      }
    }
  }
  return result;
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nodeSpecPath = path.join(repoRoot, "schema", "node-openapi.json");
const fastApiPath = path.join(repoRoot, "portal-api", "app.py");

const nodeSpec = JSON.parse(readFileSync(nodeSpecPath, "utf8"));

const python = spawnSync(
  "python",
  [
    "-c",
    [
      "import json, importlib.util, pathlib",
      `path = pathlib.Path(r"${fastApiPath}")`,
      "spec = importlib.util.spec_from_file_location(\"portal_api\", path)",
      "module = importlib.util.module_from_spec(spec)",
      "spec.loader.exec_module(module)",
      "app = module.app",
      "print(json.dumps(app.openapi()))",
    ].join("\n"),
  ],
  { encoding: "utf8" }
);

if (python.status !== 0) {
  console.error(python.stderr || python.stdout);
  throw new Error("Failed to generate FastAPI OpenAPI spec");
}

const fastSpec = JSON.parse(python.stdout.trim() || "{}");

const combined = {
  openapi: nodeSpec.openapi || fastSpec.openapi || "3.1.0",
  info: {
    title: "APGMS Console API",
    version: "1.0.0",
  },
  servers: [
    ...(nodeSpec.servers ?? []),
    ...(fastSpec.servers ?? []),
  ],
  paths: {
    ...(nodeSpec.paths ?? {}),
    ...(fastSpec.paths ?? {}),
  },
  components: mergeComponents(nodeSpec.components, fastSpec.components),
};

const targetPath = path.join(repoRoot, "openapi.json");
writeFileSync(targetPath, JSON.stringify(combined, null, 2));
console.log(`Wrote ${targetPath}`);
