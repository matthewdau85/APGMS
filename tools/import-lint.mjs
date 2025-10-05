#!/usr/bin/env node
import { readdirSync, readFileSync } from "fs";
import path from "path";
import process from "process";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

const IGNORED_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".next",
  ".turbo",
  ".pnpm-store",
  ".venv",
  "tmp",
  ".cache",
  "logs"
]);

const VALID_EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);

const providerRealPattern = /^@providers\/[^/]+\/real(?:\/|$)/;
const bannedSdkPatterns = [
  { pattern: /^@aws-sdk\//, label: "@aws-sdk" },
  { pattern: /^@google-cloud\//, label: "@google-cloud" },
  { pattern: /^aws-sdk(?:\/|$)/, label: "aws-sdk" },
  { pattern: /^google-cloud(?:\/|$)/, label: "google-cloud" },
  { pattern: /^@azure\//, label: "@azure" }
];

function walk(dir) {
  const entries = readdirSync(dir, { withFileTypes: true });
  const results = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) {
      if (!IGNORED_DIRS.has(entry.name)) {
        // hidden directories that are not explicitly ignored are still traversed
      }
    }
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      results.push(...walk(fullPath));
    } else if (entry.isFile()) {
      if (VALID_EXTS.has(path.extname(entry.name))) {
        results.push(fullPath);
      }
    }
  }
  return results;
}

function lineNumber(source, index) {
  return source.slice(0, index).split(/\r?\n/).length;
}

function isProviderReal(relPath) {
  const parts = relPath.split(path.sep);
  const fileName = parts[parts.length - 1];
  return parts.includes("providers") && fileName.startsWith("real.");
}

function isRegistry(relPath) {
  return relPath.split(path.sep).includes("registry");
}

function isBusinessModule(relPath) {
  return relPath.split(path.sep).includes("business");
}

const files = walk(repoRoot);
const errors = [];

for (const filePath of files) {
  const relPath = path.relative(repoRoot, filePath);
  const content = readFileSync(filePath, "utf8");
  const importRegex = /import\s+(?:[^'"\n;]+?\s+from\s+)?["']([^"']+)["']/g;
  const dynamicImportRegex = /import\(\s*["']([^"']+)["']\s*\)/g;
  const requireRegex = /require\(\s*["']([^"']+)["']\s*\)/g;

  const matches = [importRegex, dynamicImportRegex, requireRegex];

  for (const regex of matches) {
    let match;
    while ((match = regex.exec(content)) !== null) {
      const source = match[1];
      const line = lineNumber(content, match.index);

      if (!isRegistry(relPath) && providerRealPattern.test(source)) {
        errors.push({
          file: relPath,
          line,
          message: `Forbidden import of ${source}. Only registry modules may reference real providers.`
        });
      }

      if (isBusinessModule(relPath) && source.startsWith("@core/") && !source.startsWith("@core/ports")) {
        errors.push({
          file: relPath,
          line,
          message: `Business modules may only import from @core/ports; found ${source}.`
        });
      }

      const isConcreteSdk = bannedSdkPatterns.find(entry => entry.pattern.test(source));
      if (isConcreteSdk && !isProviderReal(relPath)) {
        errors.push({
          file: relPath,
          line,
          message: `Direct SDK import '${source}' detected (${isConcreteSdk.label}). Wrap access in a provider real module.`
        });
      }
    }
  }
}

if (errors.length) {
  console.error("Import policy violations detected:\n");
  for (const err of errors) {
    console.error(` - ${err.file}:${err.line} ${err.message}`);
  }
  console.error(`\n${errors.length} violation(s) found.`);
  process.exit(1);
}

console.log("Import policy check passed.");
