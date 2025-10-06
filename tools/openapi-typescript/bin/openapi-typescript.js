#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

function readSpec(filePath) {
  try {
    const content = fs.readFileSync(filePath, "utf8");
    return JSON.parse(content);
  } catch (err) {
    console.error(`[openapi-typescript] Failed to read ${filePath}:`, err.message);
    process.exit(1);
  }
}

function quoteKey(key) {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(key) ? key : JSON.stringify(key);
}

function generateBasSchema(schema) {
  const props = schema?.properties || {};
  const lines = Object.entries(props).map(([name]) => `      ${quoteKey(name)}: number;`);
  return `{
${lines.join("\n")}
    }`;
}

function mapArrayType(items) {
  if (!items) return "unknown[]";
  if (items.$ref === "#/components/schemas/BasLabels") {
    return 'components["schemas"]["BasLabels"][]';
  }
  if (items.type === "string") return "string[]";
  if (items.type === "number" || items.type === "integer") return "number[]";
  if (items.type === "boolean") return "boolean[]";
  return "unknown[]";
}

function resolveType(value) {
  if (!value) return "unknown";
  if (value.$ref === "#/components/schemas/BasLabels") {
    return 'components["schemas"]["BasLabels"]';
  }
  if (value.type === "string") {
    if (Array.isArray(value.enum) && value.enum.length) {
      return value.enum.map((v) => JSON.stringify(v)).join(" | ");
    }
    return "string";
  }
  if (value.type === "integer" || value.type === "number") return "number";
  if (value.type === "boolean") return "boolean";
  if (value.type === "array") return mapArrayType(value.items);
  return "unknown";
}

function generatePeriodSchema(schema) {
  const props = schema?.properties || {};
  const lines = Object.entries(props).map(([name, value]) => {
    const type = resolveType(value);
    return `      ${quoteKey(name)}: ${type};`;
  });
  return `{
${lines.join("\n")}
    }`;
}

function generateTypes(spec) {
  const basSchema = spec?.components?.schemas?.BasLabels;
  const periodSchema = spec?.components?.schemas?.PeriodSummary;
  const basLines = basSchema ? `    BasLabels: ${generateBasSchema(basSchema)};\n` : "";
  const periodLines = periodSchema ? `    PeriodSummary: ${generatePeriodSchema(periodSchema)};\n` : "";
  return `export interface components {\n  schemas: {\n${basLines}${periodLines}  };\n}\n\nexport interface paths {\n  "/api/v1/periods": {\n    get: {\n      responses: {\n        200: {\n          content: {\n            "application/json": {\n              periods: components["schemas"]["PeriodSummary"][];\n            };\n          };\n        };\n      };\n    };\n  };\n  "/api/v1/periods/{periodId}": {\n    get: {\n      responses: {\n        200: {\n          content: {\n            "application/json": components["schemas"]["PeriodSummary"];\n          };\n        };\n        404: {\n          content: {\n            "application/json": {\n              error: string;\n              message?: string;\n            };\n          };\n        };\n      };\n    };\n  };\n}\n`;
}

function main() {
  const args = process.argv.slice(2);
  if (!args.length) {
    console.error("Usage: openapi-typescript <spec-file> [-o output]");
    process.exit(1);
  }
  const specPath = path.resolve(process.cwd(), args[0]);
  let outputPath;
  const outIdx = args.indexOf("-o");
  if (outIdx !== -1 && args[outIdx + 1]) {
    outputPath = path.resolve(process.cwd(), args[outIdx + 1]);
  }

  const spec = readSpec(specPath);
  const typings = generateTypes(spec);

  if (outputPath) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, typings);
  } else {
    process.stdout.write(typings);
  }
}

main();
