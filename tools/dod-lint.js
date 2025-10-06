#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

const projectRoot = path.join(__dirname, "..");
const requiredPaths = [
  "docs/guardrails/rubric_v1.0.md",
  "ops/readiness/scorecard.json",
  "migrations/003_guardrails.sql",
];

const missing = requiredPaths.filter((p) => !fs.existsSync(path.join(projectRoot, p)));
if (missing.length) {
  console.error("Definition-of-Done check failed; missing files:", missing.join(", "));
  process.exit(1);
}

const scoreScript = path.join(__dirname, "readiness-score.js");
const result = JSON.parse(require("child_process").execSync(`node ${scoreScript}`, { encoding: "utf8" }));
if (result.composite < 0.7) {
  console.error(`Readiness composite ${result.composite.toFixed(2)} below target 0.70`);
  process.exit(1);
}

console.log(`DoD lint passed (composite=${result.composite.toFixed(2)})`);
