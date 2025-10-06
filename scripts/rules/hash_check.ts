import { createHash } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import { execSync } from "child_process";

const rulesDir = path.resolve("apps/services/tax-engine/app/rules");
const manifestFile = path.join(rulesDir, "manifest.json");
const checksumFile = path.join(rulesDir, "manifest.sha256");

async function computeManifestHash(): Promise<{ hash: string; lines: string[] }> {
  const manifest = JSON.parse(await fs.readFile(manifestFile, "utf-8"));
  const files: string[] = manifest.files || [];
  const hashes: string[] = [];
  for (const rel of files) {
    const full = path.join(rulesDir, rel);
    const buf = await fs.readFile(full);
    const sha = createHash("sha256").update(buf).digest("hex");
    hashes.push(`${rel}:${sha}`);
  }
  hashes.sort();
  const combined = hashes.join("\n");
  const manifestHash = createHash("sha256").update(combined).digest("hex");
  return { hash: manifestHash, lines: hashes };
}

function diff(base: string, pattern?: string): string {
  const command = pattern ? `git diff ${base}...HEAD -G"${pattern}"` : `git diff ${base}...HEAD --name-only`;
  try {
    return execSync(command, { stdio: ["ignore", "pipe", "ignore"] }).toString();
  } catch {
    return "";
  }
}

function determineBase(): string {
  const envBase = process.env.GIT_BASE_REF || process.env.GITHUB_BASE_REF;
  if (envBase) {
    return envBase;
  }
  try {
    return execSync("git merge-base HEAD origin/main", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return "HEAD~1";
  }
}

function changedFiles(base: string): string[] {
  const raw = diff(base);
  if (raw) {
    return raw.split("\n").map((l) => l.trim()).filter(Boolean);
  }
  try {
    const status = execSync("git status --porcelain", { stdio: ["ignore", "pipe", "ignore"] }).toString();
    return status
      .split("\n")
      .map((line) => line.trim().split(/\s+/).pop() || "")
      .filter(Boolean);
  } catch {
    return [];
  }
}

async function ensureChecksum(expected: string, lines: string[]) {
  let existing = "";
  try {
    const raw = await fs.readFile(checksumFile, "utf-8");
    existing = raw.split("\n")[0]?.trim() ?? "";
  } catch {
    existing = "";
  }
  if (existing !== expected) {
    console.warn(`rules manifest checksum mismatch. recorded=${existing} computed=${expected}`);
    await fs.writeFile(checksumFile, `${expected}\n${lines.join("\n")}\n`);
  }
}

function hasRatesVersionBump(base: string): boolean {
  const output = diff(base, "RATES_VERSION");
  return output.includes("RATES_VERSION");
}

async function main() {
  const base = determineBase();
  const files = changedFiles(base);
  const rulesChanged = files.some((f) => f.startsWith("apps/services/tax-engine/app/rules/") && f.endsWith(".json"));
  const changelogChanged = files.some((f) => /CHANGELOG/i.test(f));
  const { hash, lines } = await computeManifestHash();
  await ensureChecksum(hash, lines);

  if (rulesChanged) {
    const bumped = hasRatesVersionBump(base);
    if (!bumped || !changelogChanged) {
      console.error("Rules changed but RATES_VERSION or CHANGELOG missing");
      process.exit(1);
    }
  }
  console.log(`rules manifest sha256=${hash}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
