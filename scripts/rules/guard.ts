import { execSync } from "child_process";
import { readFileSync, existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

type GuardConfig = {
  changedFiles: string[];
  versionBefore: string | null;
  versionAfter: string | null;
  changelogChanged: boolean;
  changelogContent?: string;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const repoRoot = path.resolve(__dirname, "..", "..");
const rulesDir = path.join(repoRoot, "apps/services/tax-engine/app/rules");
const rulesDirRel = path.relative(repoRoot, rulesDir).replace(/\\/g, "/");
const versionFile = path.join(rulesDir, "version.py");
const versionFileRel = path.relative(repoRoot, versionFile).replace(/\\/g, "/");
const changelogFile = path.join(repoRoot, "CHANGELOG.md");
const changelogFileRel = path.relative(repoRoot, changelogFile).replace(/\\/g, "/");

function extractRatesVersion(source: string | null): string | null {
  if (!source) return null;
  const match = source.match(/RATES_VERSION\s*=\s*["']([^"']+)["']/);
  return match ? match[1] : null;
}

function evaluate(config: GuardConfig): void {
  const affectedRules = config.changedFiles.filter((file) => file.startsWith(rulesDirRel + "/"));
  if (affectedRules.length === 0) {
    return;
  }

  if (!config.versionAfter) {
    throw new Error("Unable to determine current RATES_VERSION.");
  }

  const versionFileChanged = config.changedFiles.includes(versionFileRel);

  if (!config.versionBefore) {
    if (!versionFileChanged) {
      throw new Error("Rules changed but RATES_VERSION file was not updated.");
    }
  } else if (config.versionBefore === config.versionAfter) {
    throw new Error("Rules changed but RATES_VERSION was not bumped.");
  }

  if (!config.changelogChanged) {
    throw new Error("Rules changed but CHANGELOG.md was not updated.");
  }

  if (config.changelogContent && !config.changelogContent.includes(config.versionAfter)) {
    throw new Error(`CHANGELOG.md must mention rates version ${config.versionAfter}.`);
  }
}

function getBaseRef(): string | null {
  const commitCandidates = [
    process.env.GITHUB_BASE_SHA,
    process.env.PR_BASE_SHA,
    process.env.BASE_SHA,
    process.env.GIT_BASE_SHA,
  ].filter(Boolean) as string[];
  if (commitCandidates.length > 0) {
    return commitCandidates[0];
  }

  const branchCandidates = [
    process.env.GITHUB_BASE_REF,
    process.env.GIT_BASE_REF,
  ].filter(Boolean) as string[];
  for (const branch of branchCandidates) {
    try {
      const ref = execSync(`git merge-base HEAD origin/${branch}`, { cwd: repoRoot, stdio: ["ignore", "pipe", "ignore"], encoding: "utf8" }).trim();
      if (ref) return ref;
    } catch {
      // ignore
    }
  }

  try {
    const ref = execSync("git merge-base HEAD origin/main", { cwd: repoRoot, stdio: ["ignore", "pipe", "ignore"], encoding: "utf8" }).trim();
    if (ref) return ref;
  } catch {
    try {
      const ref = execSync("git merge-base HEAD origin/master", { cwd: repoRoot, stdio: ["ignore", "pipe", "ignore"], encoding: "utf8" }).trim();
      if (ref) return ref;
    } catch {
      // ignore
    }
  }

  try {
    const ref = execSync("git rev-parse HEAD^", { cwd: repoRoot, stdio: ["ignore", "pipe", "ignore"], encoding: "utf8" }).trim();
    return ref || null;
  } catch {
    return null;
  }
}

function gatherChangedFiles(baseRef: string | null): string[] {
  const args = baseRef ? `${baseRef}...HEAD` : "HEAD";
  try {
    const output = execSync(`git diff --name-only ${args}`, { cwd: repoRoot, encoding: "utf8" });
    const files = output.split("\n").map((line) => line.trim()).filter(Boolean);
    if (files.length > 0) {
      return files;
    }
  } catch {
    // ignore
  }

  try {
    const output = execSync("git diff --name-only", { cwd: repoRoot, encoding: "utf8" });
    return output.split("\n").map((line) => line.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function readFileAtRef(ref: string | null, relativePath: string): string | null {
  if (!ref) return null;
  try {
    return execSync(`git show ${ref}:${relativePath}`, {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return null;
  }
}

function runRealMode(): void {
  const baseRef = getBaseRef();
  const changedFiles = gatherChangedFiles(baseRef);
  const versionAfter = extractRatesVersion(readFileSync(versionFile, "utf8"));
  const versionBefore = extractRatesVersion(readFileAtRef(baseRef, versionFileRel));
  const changelogChanged = changedFiles.includes(changelogFileRel);
  const changelogContent = changelogChanged && existsSync(changelogFile)
    ? readFileSync(changelogFile, "utf8")
    : undefined;

  evaluate({
    changedFiles,
    versionBefore,
    versionAfter,
    changelogChanged,
    changelogContent,
  });
}

function parseSimulated(argv: string[]): GuardConfig {
  const changedFiles: string[] = [];
  let versionBefore: string | null = null;
  let versionAfter: string | null = null;
  let changelogChanged = false;
  let changelogContent: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--changed") {
      const value = argv[++i];
      if (value) {
        changedFiles.push(...value.split(",").map((item) => item.trim()).filter(Boolean));
      }
    } else if (arg === "--version-before") {
      versionBefore = argv[++i] ?? null;
    } else if (arg === "--version-after") {
      versionAfter = argv[++i] ?? null;
    } else if (arg === "--changelog-changed") {
      const value = (argv[++i] ?? "false").toLowerCase();
      changelogChanged = value === "true" || value === "1";
    } else if (arg === "--changelog-content") {
      changelogContent = argv[++i];
    }
  }

  return {
    changedFiles,
    versionBefore,
    versionAfter,
    changelogChanged,
    changelogContent,
  };
}

function main(): void {
  const args = process.argv.slice(2);
  if (args.includes("--help")) {
    console.log("Usage: tsx scripts/rules/guard.ts [--simulate ...]");
    process.exit(0);
  }

  if (args.includes("--simulate")) {
    const filtered = args.filter((arg) => arg !== "--simulate");
    const config = parseSimulated(filtered);
    evaluate(config);
    return;
  }

  runRealMode();
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
}
