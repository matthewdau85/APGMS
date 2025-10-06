#!/usr/bin/env node
const { execSync } = require("child_process");
const fs = require("fs");

const RULES_DIR = "apps/services/tax-engine/app/rules";
const MANIFEST_PATH = "apps/services/tax-engine/app/rules_manifest.json";
const CHANGELOG_PATH = "docs/CHANGELOG.md";

function run(cmd) {
  return execSync(cmd, { stdio: ["pipe", "pipe", "pipe"], encoding: "utf8" }).trim();
}

function tryRun(cmd) {
  try {
    return run(cmd);
  } catch (err) {
    return null;
  }
}

function getDiffBase() {
  const baseRef = process.env.GITHUB_BASE_REF;
  if (baseRef) {
    const mb = tryRun(`git merge-base HEAD origin/${baseRef}`);
    if (mb) return mb;
  }
  tryRun("git fetch origin main --depth=1");
  const againstMain = tryRun("git merge-base HEAD origin/main");
  if (againstMain) return againstMain;
  const headParent = tryRun("git rev-parse HEAD^1");
  if (headParent) return headParent;
  return run("git rev-parse HEAD");
}

function readJSONFile(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  return JSON.parse(content);
}

function readBaseJSON(base, filePath) {
  const raw = tryRun(`git show ${base}:${filePath}`);
  if (!raw) return null;
  return JSON.parse(raw);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function main() {
  const base = getDiffBase();
  const diffOutput = run(`git diff --name-only ${base} HEAD`);
  const changed = diffOutput.split("\n").filter(Boolean);

  const rulesChanges = changed.filter((file) => file.startsWith(`${RULES_DIR}/`));
  const manifestChanged = changed.includes(MANIFEST_PATH);
  if (rulesChanges.length === 0 && !manifestChanged) {
    return;
  }

  if (!fs.existsSync(MANIFEST_PATH)) {
    console.error(`❌ Expected ${MANIFEST_PATH} to exist when rules change.`);
    process.exit(1);
  }
  const headManifest = readJSONFile(MANIFEST_PATH);
  const baseManifest = readBaseJSON(base, MANIFEST_PATH);

  if (rulesChanges.length > 0) {
    if (!baseManifest) {
      console.error("❌ Rules changed but no baseline manifest was found to compare versions against.");
      process.exit(1);
    }
    if (baseManifest.rates_version === headManifest.rates_version) {
      console.error(
        `❌ Rules changed (${rulesChanges.join(", ")}) but rules_manifest.rates_version is still '${headManifest.rates_version}'.\n` +
          "Bump the rates_version to acknowledge the regulatory change."
      );
      process.exit(1);
    }
  }

  if (!fs.existsSync(CHANGELOG_PATH)) {
    console.error(`❌ Missing ${CHANGELOG_PATH}. Add a changelog entry for tax rules updates.`);
    process.exit(1);
  }
  const changelog = fs.readFileSync(CHANGELOG_PATH, "utf8");
  const expected = new RegExp(`Tax rules update:\\s*${escapeRegExp(String(headManifest.rates_version))}`);
  if (!expected.test(changelog)) {
    console.error(
      `❌ Update ${CHANGELOG_PATH} with a line containing "Tax rules update: ${headManifest.rates_version}" when rules change.`
    );
    process.exit(1);
  }

  console.log("✅ Rules guard passed: version bump and changelog entry detected.");
}

main();
