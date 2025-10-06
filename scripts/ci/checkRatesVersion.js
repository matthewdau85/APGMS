#!/usr/bin/env node
import { execSync } from "node:child_process";

function getChangedFiles() {
  try {
    const output = execSync("git diff --name-only HEAD", { encoding: "utf8" });
    return output.split(/\r?\n/).filter(Boolean);
  } catch (err) {
    return [];
  }
}

function diffContains(pattern) {
  try {
    const diff = execSync("git diff --unified=0 HEAD", { encoding: "utf8" });
    return pattern.test(diff);
  } catch (err) {
    return false;
  }
}

const changed = getChangedFiles();
const touchedRules = changed.filter((f) => f.startsWith("apps/rules/"));

if (touchedRules.length === 0) {
  process.exit(0);
}

if (!changed.some((f) => f.toLowerCase().includes("changelog"))) {
  console.error("[ci] CHANGELOG update required when apps/rules changes");
  process.exit(1);
}

if (!diffContains(/RATES_VERSION/)) {
  console.error("[ci] RATES_VERSION must be bumped when apps/rules changes");
  process.exit(1);
}

console.log("[ci] rules change validated");
