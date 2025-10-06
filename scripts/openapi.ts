// scripts/openapi.ts
import { writeFileSync } from "fs";
import path from "path";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";

import { nodeComponents, nodePaths } from "../src/openapi/node.ts";
import type { ComponentsObject, OpenAPIDocument, PathsObject } from "../src/openapi/types.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

function mergePaths(target: PathsObject, source?: PathsObject) {
  if (!source) return;
  for (const [key, value] of Object.entries(source)) {
    if (!value) continue;
    if (!target[key]) {
      target[key] = value;
      continue;
    }
    const targetItem = target[key] || {};
    for (const [method, operation] of Object.entries(value)) {
      if (!targetItem[method]) {
        targetItem[method] = operation;
      }
    }
    target[key] = targetItem;
  }
}

function mergeComponents(target: ComponentsObject, source?: ComponentsObject) {
  if (!source) return;
  const sections: (keyof ComponentsObject)[] = [
    "schemas",
    "responses",
    "parameters",
    "requestBodies",
  ];
  for (const section of sections) {
    const sourceValue = source[section];
    if (!sourceValue) continue;
    target[section] = { ...(target[section] || {}), ...sourceValue } as any;
  }
}

function loadFastApiSpec(): OpenAPIDocument | null {
  const portalPath = path.resolve(repoRoot, "portal-api");
  const script = [
    "import json, sys, os",
    `sys.path.insert(0, ${JSON.stringify(portalPath)})`,
    "from app import app",
    "print(json.dumps(app.openapi()))",
  ].join("\n");

  const candidates = [process.env.PYTHON ?? "python3", "python"];
  for (const cmd of candidates) {
    const result = spawnSync(cmd, ["-c", script], { encoding: "utf8" });
    if (result.status === 0 && !result.error && result.stdout) {
      try {
        return JSON.parse(result.stdout);
      } catch (err) {
        throw new Error(`Failed to parse FastAPI spec: ${(err as Error).message}`);
      }
    }
  }
  console.warn("[openapi] Unable to load FastAPI spec; continuing with node routes only.");
  return null;
}

function buildSpec(): OpenAPIDocument {
  const spec: OpenAPIDocument = {
    openapi: "3.1.0",
    info: {
      title: "APGMS Unified API",
      version: "1.0.0",
      description: "Console + service endpoints aggregated from Node and FastAPI",
    },
    servers: [{ url: "/" }],
    paths: { ...nodePaths },
    components: {
      schemas: { ...(nodeComponents.schemas || {}) },
      responses: { ...(nodeComponents.responses || {}) },
      parameters: { ...(nodeComponents.parameters || {}) },
      requestBodies: { ...(nodeComponents.requestBodies || {}) },
    },
  };

  const fastApiSpec = loadFastApiSpec();
  if (fastApiSpec) {
    mergePaths(spec.paths, fastApiSpec.paths);
    if (spec.components) {
      mergeComponents(spec.components, fastApiSpec.components);
    }
  }

  return spec;
}

try {
  const spec = buildSpec();
  const outputPath = path.resolve(repoRoot, "openapi.json");
  writeFileSync(outputPath, JSON.stringify(spec, null, 2));
  console.log(`[openapi] wrote ${outputPath}`);
} catch (err) {
  console.error("[openapi] generation failed", err);
  process.exit(1);
}
