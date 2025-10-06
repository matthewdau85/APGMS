#!/usr/bin/env node
import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";

const args = process.argv.slice(2);
if (args.length < 1) {
  console.error("Usage: openapi-typescript <spec> -o <output>");
  process.exit(1);
}

const specPath = resolve(args[0]);
const outFlagIndex = args.indexOf("-o");
if (outFlagIndex === -1 || !args[outFlagIndex + 1]) {
  console.error("Missing output flag. Expected -o <file>");
  process.exit(1);
}
const outPath = resolve(args[outFlagIndex + 1]);

const spec = JSON.parse(readFileSync(specPath, "utf8"));

const indent = (level) => "  ".repeat(level);

const IDENTIFIER_REGEX = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const formatPropertyName = (name) => (IDENTIFIER_REGEX.test(name) ? name : JSON.stringify(name));

const appendBlock = (lines, baseIndent, prefix, value) => {
  if (!value) return;
  if (value.includes("\n")) {
    const parts = value.split("\n");
    lines.push(`${indent(baseIndent)}${prefix}${parts[0]}`);
    for (let i = 1; i < parts.length; i++) {
      lines.push(`${indent(baseIndent)}${parts[i]}`);
    }
    lines[lines.length - 1] = `${lines[lines.length - 1]};`;
  } else {
    lines.push(`${indent(baseIndent)}${prefix}${value};`);
  }
};

const refToTs = (ref) => {
  const match = /^#\/components\/schemas\/(.+)$/.exec(ref);
  if (match) {
    return `components["schemas"]["${match[1]}"]`;
  }
  return "unknown";
};

const schemaToTs = (schema, level = 0) => {
  if (!schema) return "unknown";
  const nullable = schema.nullable ? " | null" : "";
  if (schema.$ref) {
    return refToTs(schema.$ref) + nullable;
  }
  if (schema.enum) {
    const union = schema.enum.map((value) => JSON.stringify(value)).join(" | ") || "unknown";
    return union + nullable;
  }
  if (schema.oneOf) {
    const union = schema.oneOf.map((sub) => schemaToTs(sub, level)).join(" | ") || "unknown";
    return union + nullable;
  }
  if (schema.anyOf) {
    const union = schema.anyOf.map((sub) => schemaToTs(sub, level)).join(" | ") || "unknown";
    return union + nullable;
  }
  if (schema.allOf) {
    const intersection = schema.allOf.map((sub) => schemaToTs(sub, level)).join(" & ") || "unknown";
    return intersection + nullable;
  }
  switch (schema.type) {
    case "string":
      return "string" + nullable;
    case "integer":
    case "number":
      return "number" + nullable;
    case "boolean":
      return "boolean" + nullable;
    case "array": {
      const inner = schema.items ? schemaToTs(schema.items, level) : "unknown";
      return `(${inner})[]` + nullable;
    }
    case "object":
    case undefined: {
      const props = schema.properties ?? {};
      const required = new Set(schema.required ?? []);
      const entries = Object.entries(props);
      const lines = ["{"];
      const nextLevel = level + 1;
      for (const [key, value] of entries) {
        const propType = schemaToTs(value, nextLevel);
        const formatted = formatPropertyName(key);
        const optional = required.has(key) ? "" : "?";
        if (propType.includes("\n")) {
          const segments = propType.split("\n");
          lines.push(`${indent(nextLevel)}${formatted}${optional}: ${segments[0]}`);
          for (let i = 1; i < segments.length; i++) {
            lines.push(`${indent(nextLevel)}${segments[i]}`);
          }
          lines[lines.length - 1] = `${lines[lines.length - 1]};`;
        } else {
          lines.push(`${indent(nextLevel)}${formatted}${optional}: ${propType};`);
        }
      }
      if (schema.additionalProperties) {
        const apType =
          schema.additionalProperties === true
            ? "unknown"
            : schemaToTs(schema.additionalProperties, nextLevel);
        if (apType.includes("\n")) {
          const segments = apType.split("\n");
          lines.push(`${indent(nextLevel)}[key: string]: ${segments[0]}`);
          for (let i = 1; i < segments.length; i++) {
            lines.push(`${indent(nextLevel)}${segments[i]}`);
          }
          lines[lines.length - 1] = `${lines[lines.length - 1]};`;
        } else {
          lines.push(`${indent(nextLevel)}[key: string]: ${apType};`);
        }
      } else if (entries.length === 0) {
        lines.push(`${indent(nextLevel)}[key: string]: unknown;`);
      }
      lines.push(`${indent(level)}}`);
      return lines.join("\n") + nullable;
    }
    default:
      return "unknown" + nullable;
  }
};

const generateComponents = () => {
  const schemas = spec.components?.schemas ?? {};
  const lines = ["export interface components {"]; 
  lines.push(`${indent(1)}schemas: {`);
  if (Object.keys(schemas).length === 0) {
    lines.push(`${indent(2)}[key: string]: unknown;`);
  } else {
    for (const [name, schema] of Object.entries(schemas)) {
      const ts = schemaToTs(schema, 2);
      appendBlock(lines, 2, `${name}: `, ts);
    }
  }
  lines.push(`${indent(1)}};`);
  lines.push("}");
  return lines.join("\n");
};

const generateParameters = (parameters = [], level = 0) => {
  if (!parameters.length) return undefined;
  const grouped = new Map();
  for (const param of parameters) {
    const group = grouped.get(param.in) ?? [];
    group.push(param);
    grouped.set(param.in, group);
  }
  const lines = ["{"];
  const nextLevel = level + 1;
  for (const [location, params] of grouped.entries()) {
    const locLines = ["{"];
    const locLevel = nextLevel + 1;
    for (const param of params) {
      const formatted = formatPropertyName(param.name);
      const optional = param.required ? "" : "?";
      const type = schemaToTs(param.schema ?? { type: "string" }, locLevel);
      const typeWithIndent = type.includes("\n") ? `\n${type}\n${indent(locLevel)}` : type;
      locLines.push(`${indent(locLevel)}${formatted}${optional}: ${typeWithIndent};`);
    }
    locLines.push(`${indent(nextLevel)}}`);
    const locBody = locLines.join("\n");
    lines.push(`${indent(nextLevel)}${location}: ${locBody};`);
  }
  lines.push(`${indent(level)}}`);
  return lines.join("\n");
};

const generateContent = (content, level) => {
  const entries = Object.entries(content ?? {});
  if (!entries.length) return undefined;
  const lines = ["{"];
  const nextLevel = level + 1;
  for (const [type, schema] of entries) {
    const ts = schemaToTs(schema.schema ?? schema, nextLevel);
    const tsWithIndent = ts.includes("\n") ? `\n${ts}\n${indent(nextLevel)}` : ts;
    lines.push(`${indent(nextLevel)}"${type}": ${tsWithIndent};`);
  }
  lines.push(`${indent(level)}}`);
  return lines.join("\n");
};

const generateResponses = (responses, level) => {
  const entries = Object.entries(responses ?? {});
  if (!entries.length) return "{}";
  const lines = ["{"];
  const nextLevel = level + 1;
  for (const [status, response] of entries) {
    const respLines = ["{"];
    const respLevel = nextLevel + 1;
    if (response?.description) {
      respLines.push(`${indent(respLevel)}description: ${JSON.stringify(response.description)};`);
    }
    const content = generateContent(response?.content, respLevel);
    if (content) {
      const contentWithIndent = content.replace(/\n/g, `\n${indent(respLevel)}`);
      respLines.push(`${indent(respLevel)}content: ${contentWithIndent};`);
    }
    respLines.push(`${indent(nextLevel)}}`);
    lines.push(`${indent(nextLevel)}"${status}": ${respLines.join("\n")};`);
  }
  lines.push(`${indent(level)}}`);
  return lines.join("\n");
};

const generateRequestBody = (requestBody, level) => {
  if (!requestBody) return undefined;
  const lines = ["{"];
  const nextLevel = level + 1;
  if (requestBody.required) {
    lines.push(`${indent(nextLevel)}required: true;`);
  }
  const content = generateContent(requestBody.content, nextLevel);
  if (content) {
    const formatted = content.replace(/\n/g, `\n${indent(nextLevel)}`);
    lines.push(`${indent(nextLevel)}content: ${formatted};`);
  }
  lines.push(`${indent(level)}}`);
  return lines.join("\n");
};

const generatePaths = () => {
  const lines = ["export interface paths {"]; 
  const paths = spec.paths ?? {};
  for (const [route, operations] of Object.entries(paths)) {
    const opLines = ["{"];
    const opLevel = 2;
    for (const [method, operation] of Object.entries(operations)) {
      const methodLines = ["{"];
      const methodLevel = 3;
      const params = generateParameters(operation.parameters ?? [], methodLevel);
      appendBlock(methodLines, methodLevel, "parameters: ", params);
      const requestBody = generateRequestBody(operation.requestBody, methodLevel);
      appendBlock(methodLines, methodLevel, "requestBody: ", requestBody);
      const responses = generateResponses(operation.responses ?? {}, methodLevel);
      appendBlock(methodLines, methodLevel, "responses: ", responses);
      methodLines.push(`${indent(2)}}`);
      opLines.push(`${indent(2)}${method}: ${methodLines.join("\n")};`);
    }
    opLines.push(`${indent(1)}}`);
    lines.push(`${indent(1)}"${route}": ${opLines.join("\n")};`);
  }
  if (Object.keys(paths).length === 0) {
    lines.push(`${indent(1)}[route: string]: Record<string, unknown>;`);
  }
  lines.push("}");
  return lines.join("\n");
};

const header = `// Generated by tools/openapi-typescript.mjs. Do not edit manually.\n// eslint-disable-next-line @typescript-eslint/triple-slash-reference\n`;
const body = `${generateComponents()}\n\n${generatePaths()}\n`;

writeFileSync(outPath, `${header}${body}`);
console.log(`wrote ${outPath}`);
