#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "src");
const disallowed = /from\s+['"].*mockData['"]/;
let found = false;
const violations = [];

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full);
    } else if (/\.(t|j)sx?$/.test(entry.name) && !full.endsWith(`${path.sep}mockData.ts`)) {
      const content = fs.readFileSync(full, "utf8");
      if (disallowed.test(content)) {
        found = true;
        const rel = path.relative(path.join(__dirname, ".."), full);
        violations.push(rel);
      }
    }
  }
}

if (!fs.existsSync(ROOT)) {
  console.warn("No src directory to lint");
  process.exit(0);
}

walk(ROOT);

if (found) {
  console.error("Mock data imports are not allowed in UI code. Remove imports in:\n" + violations.join("\n"));
  process.exit(1);
}

console.log("✓ No mock data imports detected.");
