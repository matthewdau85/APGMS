const { writeFileSync } = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

type OpenAPISpec = {
  openapi: string;
  info: { title: string; version: string; description?: string };
  paths?: Record<string, any>;
  components?: Record<string, any>;
  tags?: Array<Record<string, any>>;
  servers?: Array<Record<string, any>>;
};

const rootDir = path.resolve(__dirname, "..");
const portalApiPath = path.join(rootDir, "portal-api", "app.py");
const outputPath = path.join(rootDir, "openapi.json");

function getFastApiSpec(): OpenAPISpec | null {
  const script = `import json, importlib.util, pathlib, sys\npath = pathlib.Path(${JSON.stringify(
    portalApiPath
  )})\nif not path.exists():\n    raise SystemExit(0)\nspec = importlib.util.spec_from_file_location("portal_api_app", path)\nmodule = importlib.util.module_from_spec(spec)\nspec.loader.exec_module(module)\napp = getattr(module, "app", None)\nif app is None:\n    raise SystemExit(0)\nprint(json.dumps(app.openapi()))`;
  const result = spawnSync("python3", ["-c", script], {
    cwd: rootDir,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    const stderr = (result.stderr || result.stdout || "").trim();
    if (stderr) {
      console.warn("[openapi] Unable to load FastAPI spec:", stderr);
    }
    return null;
  }
  const text = (result.stdout || "").trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (err) {
    console.warn("[openapi] Failed to parse FastAPI spec:", err);
    return null;
  }
}

const nodeSpec: OpenAPISpec = {
  openapi: "3.0.3",
  info: {
    title: "APGMS Node API",
    version: "1.0.0",
    description: "Endpoints served by the Node/Express application.",
  },
  servers: [{ url: "/" }],
  paths: {
    "/api/v1/periods": {
      get: {
        summary: "List accounting periods",
        responses: {
          200: {
            description: "Known periods",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    periods: {
                      type: "array",
                      items: { $ref: "#/components/schemas/PeriodSummary" },
                    },
                  },
                  required: ["periods"],
                },
              },
            },
          },
        },
      },
    },
    "/api/v1/periods/{periodId}": {
      get: {
        summary: "Fetch a single accounting period",
        parameters: [
          {
            name: "periodId",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: {
          200: {
            description: "Period details",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/PeriodSummary" },
              },
            },
          },
          404: {
            description: "No period found",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    error: { type: "string" },
                    message: { type: "string" },
                  },
                  required: ["error"],
                },
              },
            },
          },
        },
      },
    },
  },
  components: {
    schemas: {
      BasLabels: {
        type: "object",
        properties: {
          W1: { type: "integer", description: "Gross wages (cents)" },
          W2: { type: "integer", description: "PAYGW withheld (cents)" },
          G1: { type: "integer", description: "Total sales (cents)" },
          "1A": { type: "integer", description: "GST on sales (cents)" },
          "1B": { type: "integer", description: "GST on purchases (cents)" },
        },
        required: ["W1", "W2", "G1", "1A", "1B"],
      },
      PeriodSummary: {
        type: "object",
        properties: {
          id: { type: "string" },
          abn: { type: "string" },
          taxType: { type: "string", enum: ["GST", "PAYGW"] },
          periodLabel: { type: "string" },
          lodgmentsUpToDate: { type: "boolean" },
          paymentsUpToDate: { type: "boolean" },
          complianceScore: { type: "integer", minimum: 0, maximum: 100 },
          lastBasLodgedAt: { type: "string", format: "date" },
          nextDueAt: { type: "string", format: "date" },
          outstandingLodgments: {
            type: "array",
            items: { type: "string" },
          },
          outstandingAmounts: {
            type: "array",
            items: { type: "string" },
          },
          bas: { $ref: "#/components/schemas/BasLabels" },
        },
        required: [
          "id",
          "abn",
          "taxType",
          "periodLabel",
          "lodgmentsUpToDate",
          "paymentsUpToDate",
          "complianceScore",
          "lastBasLodgedAt",
          "nextDueAt",
          "outstandingLodgments",
          "outstandingAmounts",
          "bas",
        ],
      },
    },
  },
};

function mergeSpecs(base: OpenAPISpec, extra: OpenAPISpec | null): OpenAPISpec {
  if (!extra) return base;
  const merged: OpenAPISpec = {
    openapi: extra.openapi || base.openapi,
    info: {
      title: "APGMS Combined API",
      version: base.info.version,
      description: [base.info.description, extra.info?.description]
        .filter(Boolean)
        .join("\n\n") || base.info.description,
    },
    paths: { ...base.paths },
    components: { ...base.components },
    tags: base.tags ? [...base.tags] : undefined,
    servers: base.servers ? [...base.servers] : undefined,
  };

  if (extra.paths) {
    merged.paths = merged.paths || {};
    for (const [p, item] of Object.entries(extra.paths)) {
      merged.paths[p] = { ...(merged.paths[p] || {}), ...item };
    }
  }

  if (extra.components) {
    merged.components = merged.components || {};
    for (const [key, value] of Object.entries(extra.components)) {
      const existing = (merged.components[key] = merged.components[key] || {});
      Object.assign(existing, value);
    }
  }

  if (extra.tags) {
    merged.tags = merged.tags || [];
    const seen = new Set((merged.tags || []).map((t) => JSON.stringify(t)));
    for (const tag of extra.tags) {
      const serialised = JSON.stringify(tag);
      if (!seen.has(serialised)) {
        merged.tags.push(tag);
        seen.add(serialised);
      }
    }
  }

  if (extra.servers) {
    merged.servers = merged.servers || [];
    const seen = new Set((merged.servers || []).map((s) => JSON.stringify(s)));
    for (const server of extra.servers) {
      const serialised = JSON.stringify(server);
      if (!seen.has(serialised)) {
        merged.servers.push(server);
        seen.add(serialised);
      }
    }
  }

  return merged;
}

const fastApiSpec = getFastApiSpec();
const combined = mergeSpecs(nodeSpec, fastApiSpec);

writeFileSync(outputPath, JSON.stringify(combined, null, 2));
console.log(`Wrote OpenAPI spec to ${outputPath}`);
