#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

const MANIFEST_PATH = path.join(__dirname, "../../apps/services/tax-engine/app/rules_manifest.json");
const RULES_DIR = path.join(__dirname, "../../apps/services/tax-engine/app/rules");

function loadManifest() {
  const content = fs.readFileSync(MANIFEST_PATH, "utf8").replace(/^\uFEFF/, "");
  return JSON.parse(content);
}

function ensureFileFormatted(filePath) {
  const raw = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
  const data = JSON.parse(raw);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n");
}

function main() {
  const manifest = loadManifest();
  const periods = manifest.effective_periods || [];
  if (periods.length === 0) {
    console.warn("No effective periods declared in rules manifest.");
    return;
  }
  let checked = 0;
  for (const entry of periods) {
    if (!entry.file) continue;
    const filePath = path.join(RULES_DIR, entry.file);
    if (!fs.existsSync(filePath)) {
      console.error(`Missing rules file referenced in manifest: ${entry.file}`);
      process.exit(1);
    }
    ensureFileFormatted(filePath);
    checked += 1;
  }
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + "\n");
  console.log(`Validated ${checked} rule files from manifest version ${manifest.rates_version}.`);
}

main();
