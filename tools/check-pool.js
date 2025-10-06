#!/usr/bin/env node
const { readdirSync, readFileSync, statSync } = require("node:fs");
const { join } = require("node:path");

const root = process.cwd();
const violations = [];

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith(".")) continue;
    const full = join(dir, entry);
    const rel = full.slice(root.length + 1);
    if (
      rel.includes("node_modules") ||
      rel.startsWith("dist") ||
      rel.includes(".bak") ||
      rel.endsWith(".ps1") ||
      rel.startsWith("apps/")
    ) {
      continue;
    }
    const info = statSync(full);
    if (info.isDirectory()) {
      walk(full);
      continue;
    }
    if (!rel.endsWith(".ts") && !rel.endsWith(".tsx")) continue;
    if (rel === "src/db/pool.ts") continue;
    const text = readFileSync(full, "utf8");
    if (text.includes("new Pool(")) {
      violations.push(rel);
    }
  }
}

walk(root);

if (violations.length > 0) {
  console.error("Found disallowed pg.Pool constructors:");
  for (const file of violations) {
    console.error(" -", file);
  }
  process.exit(1);
}
