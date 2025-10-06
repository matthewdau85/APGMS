import { promises as fs } from "fs";
import path from "path";
import { execSync } from "child_process";

interface Requirement {
  path: string;
  hint?: string;
}

interface DodDoc {
  label: string;
  description?: string;
  requires?: Requirement[];
}

async function main() {
  const labels = await readLabels();
  if (labels.length === 0) {
    console.log("No readiness DoD labels present. Skipping.");
    return;
  }
  const changedFiles = await listChangedFiles();
  const errors: string[] = [];

  for (const label of labels) {
    const doc = await loadDoc(label);
    if (!doc) {
      errors.push(`Missing DoD definition for label '${label}'. Expected docs/dod/${label}.yml`);
      continue;
    }
    const requires = doc.requires ?? [];
    const missing = requires.filter(req => !satisfiesRequirement(changedFiles, req));
    if (missing.length > 0) {
      errors.push(`Label '${label}' is missing required updates: ${missing.map(m => formatRequirement(m)).join(", ")}`);
    } else {
      console.log(`✓ ${label} DoD satisfied (${requires.length} requirement${requires.length === 1 ? "" : "s"})`);
    }
  }

  if (errors.length > 0) {
    console.error("DoD check failed:\n" + errors.map(e => ` - ${e}`).join("\n"));
    process.exitCode = 1;
  }
}

async function readLabels(): Promise<string[]> {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (eventPath) {
    try {
      const raw = await fs.readFile(eventPath, "utf8");
      const event = JSON.parse(raw);
      const labels: string[] = event?.pull_request?.labels?.map((l: any) => l.name)?.filter(Boolean) ?? [];
      return labels.filter(isTrackedLabel);
    } catch (err) {
      console.warn("Failed to parse GITHUB_EVENT_PATH", err);
    }
  }
  const fallback = process.env.DOD_LABELS?.split(",").map(s => s.trim()).filter(Boolean) ?? [];
  return fallback.filter(isTrackedLabel);
}

function isTrackedLabel(label: string): boolean {
  const tracked = ["rails", "rules", "evidence", "security", "prototype"];
  return tracked.includes(label);
}

async function loadDoc(label: string): Promise<DodDoc | null> {
  const docPath = path.join(process.cwd(), "docs", "dod", `${label}.yml`);
  try {
    const raw = await fs.readFile(docPath, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    return null;
  }
}

async function listChangedFiles(): Promise<string[]> {
  const baseRef = process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : undefined;
  const cwd = process.cwd();
  try {
    if (baseRef) {
      const diff = execSync(`git diff --name-only ${baseRef}...HEAD`, { cwd, encoding: "utf8" });
      return diff.split("\n").map(l => l.trim()).filter(Boolean);
    }
  } catch (err) {
    console.warn(`Failed to diff against ${baseRef}`, err);
  }
  if (hasParentCommit()) {
    const diff = execSync("git diff --name-only HEAD^ HEAD", { cwd, encoding: "utf8" });
    return diff.split("\n").map(l => l.trim()).filter(Boolean);
  }
  const files = execSync("git ls-files", { cwd, encoding: "utf8" });
  return files.split("\n").map(l => l.trim()).filter(Boolean);
}

function hasParentCommit(): boolean {
  try {
    execSync("git rev-parse --verify HEAD^", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function satisfiesRequirement(files: string[], req: Requirement): boolean {
  const target = req.path;
  if (target.endsWith("/")) {
    return files.some(f => f.startsWith(target));
  }
  return files.some(f => f === target || f.startsWith(`${target}/`));
}

function formatRequirement(req: Requirement): string {
  if (req.hint) return `${req.path} (${req.hint})`;
  return req.path;
}

main().catch(err => {
  console.error("DoD check crashed", err);
  process.exitCode = 1;
});
