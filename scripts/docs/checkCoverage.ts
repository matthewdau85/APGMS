#!/usr/bin/env ts-node
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

const TAX_MAIN_PATH = "apps/services/tax-engine/app/main.py";
const DOCS_ROOT = "docs";

function extractEndpoints(source: string): string[] {
  const pattern = /@app\.(get|post|put|delete|patch)\(\s*"([^"]+)"/g;
  const endpoints = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    const path = match[2];
    if (path.startsWith("/tax/")) {
      endpoints.add(path);
    }
  }
  return Array.from(endpoints.values());
}

function collectDocs(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const docs: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      docs.push(...collectDocs(full));
    } else if (entry.isFile() && entry.name.endsWith(".mdx")) {
      docs.push(readFileSync(full, "utf8"));
    }
  }
  return docs;
}

function main() {
  const source = readFileSync(TAX_MAIN_PATH, "utf8");
  const endpoints = extractEndpoints(source);
  if (endpoints.length === 0) {
    console.warn("⚠️ No /tax endpoints found in tax engine; skipping docs coverage check.");
    return;
  }
  const docsContent = collectDocs(DOCS_ROOT);
  if (docsContent.length === 0) {
    console.error("❌ No MDX documentation found under docs/. Add coverage for tax endpoints.");
    process.exit(1);
  }
  const combined = docsContent.join("\n");
  const missing = endpoints.filter((path) => !combined.includes(path));
  if (missing.length > 0) {
    console.error(
      "❌ The following tax endpoints are missing from docs/**/*.mdx:\n" +
        missing.map((p) => ` - ${p}`).join("\n")
    );
    process.exit(1);
  }
  console.log("✅ Documentation coverage check passed for tax endpoints:", endpoints.join(", "));
}

main();
