import { spawnSync } from "child_process";
import { writeFile } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

async function main() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(here, "..");
  const pythonCode = `
import json, sys, pathlib
from fastapi.responses import PlainTextResponse
root = pathlib.Path(${JSON.stringify(repoRoot)})
sys.path.insert(0, str(root / "portal-api"))
from app import app
for route in app.routes:
    if getattr(route, "response_class", None) is None:
        route.response_class = PlainTextResponse
spec = app.openapi()
json.dump(spec, sys.stdout)
`;
  const result = spawnSync("python", ["-c", pythonCode], {
    cwd: repoRoot,
    encoding: "utf-8",
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      `python exited with code ${result.status}: ${result.stderr || ""}`.trim()
    );
  }
  const stdout = result.stdout?.trim();
  if (!stdout) {
    throw new Error("python did not emit OpenAPI schema");
  }
  const spec = JSON.parse(stdout) as Record<string, any>;
  const schemas = ((spec.components = spec.components ?? {}), spec.components.schemas = spec.components.schemas ?? {});

  const ensureSchema = (
    name: string,
    schema: Record<string, any>,
  ) => {
    if (!schemas[name]) {
      schemas[name] = schema;
    }
    return schemas[name];
  };

  ensureSchema("DashboardYesterday", {
    type: "object",
    required: ["jobs", "success_rate", "top_errors"],
    properties: {
      jobs: { type: "integer", title: "Jobs" },
      success_rate: { type: "number", title: "Success Rate" },
      top_errors: { type: "array", items: { type: "string" }, title: "Top Errors" },
    },
    title: "DashboardYesterday",
  });

  ensureSchema("BasPreview", {
    type: "object",
    required: ["period", "GSTPayable", "PAYGW", "Total"],
    properties: {
      period: { type: "string", title: "Period" },
      GSTPayable: { type: "number", title: "GSTPayable" },
      PAYGW: { type: "number", title: "PAYGW" },
      Total: { type: "number", title: "Total" },
    },
    title: "BasPreview",
  });

  ensureSchema("AtoStatus", {
    type: "object",
    required: ["status"],
    properties: {
      status: { type: "string", title: "Status" },
    },
    title: "AtoStatus",
  });

  const attachResponseSchema = (
    pathKey: string,
    method: string,
    schemaRef: Record<string, any>,
  ) => {
    const entry = spec.paths?.[pathKey]?.[method];
    if (!entry) return;
    const content =
      entry.responses?.["200"]?.content ??
      (entry.responses ? (entry.responses["200"].content = {}) : undefined);
    if (!content) return;
    const jsonSchema = (content["application/json"] = content["application/json"] ?? {});
    const currentSchema = jsonSchema.schema;
    if (!currentSchema || Object.keys(currentSchema).length === 0) {
      jsonSchema.schema = schemaRef;
    }
  };

  attachResponseSchema("/dashboard/yesterday", "get", { $ref: "#/components/schemas/DashboardYesterday" });
  attachResponseSchema("/bas/preview", "get", { $ref: "#/components/schemas/BasPreview" });
  attachResponseSchema("/ato/status", "get", { $ref: "#/components/schemas/AtoStatus" });

  const outputPath = path.resolve(repoRoot, "openapi.json");
  await writeFile(outputPath, JSON.stringify(spec, null, 2), "utf-8");
  console.log(`OpenAPI schema written to ${path.relative(repoRoot, outputPath)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
