import { readFileSync, writeFileSync, readdirSync, statSync } from "fs";
import { join, resolve } from "path";

interface OpenAPIObject {
  openapi: string;
  info: { title: string; version: string; description?: string };
  paths: Record<string, any>;
  components?: Record<string, any>;
}

const ROOT = resolve(".");
const SEARCH_DIRS = [
  join(ROOT, "src", "routes"),
  join(ROOT, "apps", "services", "payments", "src", "routes"),
];

function findTsFiles(dir: string): string[] {
  try {
    const entries = readdirSync(dir);
    return entries.flatMap((entry) => {
      const full = join(dir, entry);
      const stats = statSync(full);
      if (stats.isDirectory()) {
        return findTsFiles(full);
      }
      return full.endsWith(".ts") ? [full] : [];
    });
  } catch (err) {
    return [];
  }
}

const SPEC: OpenAPIObject = {
  openapi: "3.0.0",
  info: { title: "APGMS", version: "1.0.0" },
  paths: {},
  components: {},
};

const commentRegex = /\/\*\*[\s\S]*?@openapi([\s\S]*?)\*\//g;

function stripCommentStars(block: string): string {
  return block
    .split("\n")
    .map((line) => line.replace(/^\s*\*?\s?/, ""))
    .join("\n")
    .trim();
}

function mergeDeep(target: any, source: any): any {
  if (typeof source !== "object" || source === null) {
    return target;
  }
  Object.entries(source).forEach(([key, value]) => {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      target[key] = mergeDeep(target[key] ?? {}, value);
    } else if (Array.isArray(value)) {
      const existing = Array.isArray(target[key]) ? target[key] : [];
      target[key] = [...existing, ...value];
    } else {
      target[key] = value;
    }
  });
  return target;
}

for (const dir of SEARCH_DIRS) {
  const files = findTsFiles(dir);
  for (const file of files) {
    const content = readFileSync(file, "utf8");
    const matches = content.matchAll(commentRegex);
    for (const match of matches) {
      const body = stripCommentStars(match[1] ?? "");
      if (!body) continue;
      try {
        const parsed = JSON.parse(body);
        if (parsed.paths) {
          SPEC.paths = mergeDeep(SPEC.paths, parsed.paths);
        }
        if (parsed.components) {
          SPEC.components = mergeDeep(SPEC.components ?? {}, parsed.components);
        }
      } catch (err) {
        console.warn(`Failed to parse @openapi block in ${file}:`, err);
      }
    }
  }
}

if (SPEC.components && Object.keys(SPEC.components).length === 0) {
  delete SPEC.components;
}

writeFileSync("openapi.json", JSON.stringify(SPEC, null, 2));
console.log("openapi.json written");
