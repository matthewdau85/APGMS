// scripts/client-gen.ts
import { readFileSync, writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

type Schema = {
  type?: string;
  format?: string;
  description?: string;
  enum?: string[];
  required?: string[];
  properties?: Record<string, Schema>;
  items?: Schema;
  additionalProperties?: boolean | Schema;
  nullable?: boolean;
  $ref?: string;
};

type OpenApi = {
  components?: { schemas?: Record<string, Schema> };
  paths: Record<string, Record<string, any>>;
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const specPath = path.resolve(repoRoot, "openapi.json");
const outputPath = path.resolve(repoRoot, "src/api/types.ts");

const raw = readFileSync(specPath, "utf8");
const spec: OpenApi = JSON.parse(raw);

const schemaOrder = Object.keys(spec.components?.schemas || {});

function refName(ref: string): string {
  const parts = ref.split("/");
  return parts[parts.length - 1] || ref;
}

function renderSchemaType(schema: Schema): string {
  if (!schema) return "unknown";
  if (schema.$ref) {
    return `components["schemas"]["${refName(schema.$ref)}"]`;
  }
  let base: string;
  switch (schema.type) {
    case "string":
      base = schema.enum ? schema.enum.map(v => JSON.stringify(v)).join(" | ") : "string";
      break;
    case "integer":
    case "number":
      base = "number";
      break;
    case "boolean":
      base = "boolean";
      break;
    case "array":
      base = `${renderSchemaType(schema.items || { type: "unknown" })}[]`;
      break;
    case "object": {
      const props = schema.properties || {};
      const required = new Set(schema.required || []);
      const entries = Object.entries(props).map(([key, value]) => {
        const optional = !required.has(key);
        const typeStr = renderSchemaType(value);
        const formatted = typeStr.includes("\n")
          ? typeStr
              .split("\n")
              .map((line, index) => (index === 0 ? line : `  ${line}`))
              .join("\n")
          : typeStr;
        return `${key}${optional ? "?" : ""}: ${formatted};`;
      });
      const indented = entries.map(line => `  ${line}`);
      base = indented.length ? `{
${indented.join("\n")}
}` : "Record<string, unknown>";
      break;
    }
    default:
      base = "unknown";
  }
  if (schema.nullable && schema.type !== "object") {
    base = `${base} | null`;
  }
  return base;
}

function renderSchemaDefs(): string {
  return schemaOrder
    .map((name) => {
      const schema = spec.components?.schemas?.[name];
      if (!schema) return "";
      const typeBody = renderSchemaType(schema);
      return `export type ${name} = ${typeBody};\n`;
    })
    .join("\n");
}

function renderComponentsInterface(): string {
  const schemaEntries = schemaOrder
    .map((name) => `    ${name}: ${name};`)
    .join("\n");
  return `export interface components {\n  schemas: {\n${schemaEntries ? schemaEntries + "\n" : ""}  };\n  responses: Record<string, never>;\n  parameters: Record<string, never>;\n  requestBodies: Record<string, never>;\n}\n`;
}

function renderPathsInterface(): string {
  const pathLines = Object.entries(spec.paths || {})
    .map(([pathKey, methods]) => {
      const methodLines = Object.entries(methods)
        .map(([method, operation]) => {
          const responses = operation?.responses || {};
          const ok = responses["200"] || responses[200];
          const schema: Schema | undefined = ok?.content?.["application/json"]?.schema;
          const responseType = schema ? renderSchemaType(schema) : "unknown";
          return `    ${method}: {\n      responses: {\n        200: {\n          content: {\n            \"application/json\": ${responseType};\n          };\n        };\n      };\n    };`;
        })
        .join("\n");
      return `  \"${pathKey}\": {\n${methodLines}\n  };`;
    })
    .join("\n");

  return `export interface paths {\n${pathLines}\n}\n`;
}

const fileContents = `// Auto-generated via scripts/client-gen.ts\n/* eslint-disable */\n\n${renderSchemaDefs()}\n${renderComponentsInterface()}\n${renderPathsInterface()}`;

writeFileSync(outputPath, fileContents);
console.log(`[client-gen] wrote ${path.relative(repoRoot, outputPath)}`);
