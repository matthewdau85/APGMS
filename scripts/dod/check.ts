import { promises as fs } from "fs";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { fileURLToPath } from "url";

const execFileAsync = promisify(execFile);

interface DodCheck {
  id: string;
  description: string;
  patterns: string[];
  mode?: "any" | "all";
  match?: "changed" | "tracked";
  optional?: boolean;
  onlyWhenChanged?: string[];
}

interface DodDefinition {
  id: string;
  name: string;
  description?: string;
  labels?: string[];
  rules_version?: string;
  checks?: DodCheck[];
  sourcePath: string;
}

interface CheckResult {
  check: DodCheck;
  status: "pass" | "fail" | "skipped";
  matched: string[];
  missing?: string[];
}

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(currentDir, "..", "..");
const dodDir = path.join(repoRoot, "docs", "dod");

function normalizePath(p: string): string {
  return p.replace(/\\/g, "/");
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function patternToRegex(pattern: string): RegExp {
  const normalized = normalizePath(pattern.trim());
  let regex = "";
  for (let i = 0; i < normalized.length; i++) {
    const char = normalized[i];
    if (char === "*") {
      const next = normalized[i + 1];
      if (next === "*") {
        regex += ".*";
        i++;
      } else {
        regex += "[^/]*";
      }
    } else {
      regex += escapeRegex(char);
    }
  }
  return new RegExp(`^${regex}$`);
}

function splitList(value?: string | null): string[] {
  if (!value) return [];
  return value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

async function readJsonYaml(filePath: string): Promise<any> {
  const raw = await fs.readFile(filePath, "utf8");
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`Failed to parse ${filePath}: ${(err as Error).message}`);
  }
}

async function loadDefinitions(): Promise<DodDefinition[]> {
  let entries: string[] = [];
  try {
    entries = await fs.readdir(dodDir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw err;
  }
  const defs: DodDefinition[] = [];
  for (const file of entries) {
    if (!file.endsWith(".yml") && !file.endsWith(".yaml")) continue;
    const sourcePath = path.join(dodDir, file);
    const data = await readJsonYaml(sourcePath);
    defs.push({ ...data, sourcePath });
  }
  return defs;
}

async function getGitOutput(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd: repoRoot });
  return stdout.trim();
}

async function diffAgainst(base: string, head: string): Promise<string[] | null> {
  try {
    await execFileAsync("git", ["rev-parse", "--verify", base], { cwd: repoRoot });
  } catch {
    return null;
  }
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["diff", "--name-only", `${base}...${head}`],
      { cwd: repoRoot }
    );
    return stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map(normalizePath);
  } catch (err) {
    return null;
  }
}

async function getChangedFiles(): Promise<string[]> {
  const head = process.env.GITHUB_SHA || "HEAD";
  const baseCandidates = [
    process.env.DOD_BASE_REF,
    process.env.GITHUB_BASE_REF,
    process.env.PR_BASE_REF,
    process.env.CI_MERGE_REQUEST_TARGET_BRANCH_NAME,
    "origin/main",
    "origin/master",
    "main",
    "master"
  ];
  for (const candidate of baseCandidates) {
    if (!candidate) continue;
    const diff = await diffAgainst(candidate, head);
    if (diff) {
      return Array.from(new Set(diff));
    }
  }
  // Fallback to previous commit
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["rev-parse", "HEAD^"],
      { cwd: repoRoot }
    );
    const base = stdout.trim();
    const { stdout: diffOut } = await execFileAsync(
      "git",
      ["diff", "--name-only", `${base}`, head],
      { cwd: repoRoot }
    );
    return diffOut
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map(normalizePath);
  } catch {
    // Last resort: unstaged changes (should not happen in CI, but keeps local runs usable)
    const status = await getGitOutput(["status", "--porcelain"]);
    if (!status) return [];
    return status
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => normalizePath(line.slice(3)));
  }
}

async function getTrackedFiles(): Promise<string[]> {
  const output = await getGitOutput(["ls-files"]);
  if (!output) return [];
  return output.split("\n").map((line) => normalizePath(line.trim())).filter(Boolean);
}

function matchAny(files: Iterable<string>, pattern: string): string[] {
  const regex = patternToRegex(pattern);
  const matches: string[] = [];
  for (const file of files) {
    if (regex.test(file)) {
      matches.push(file);
    }
  }
  return matches;
}

function evaluateCheck(
  check: DodCheck,
  changedFiles: Set<string>,
  trackedFiles: Set<string>
): CheckResult {
  const mode = check.mode ?? "any";
  const matchSet = (check.match ?? "changed") === "tracked" ? trackedFiles : changedFiles;
  const patterns = check.patterns ?? [];
  if (patterns.length === 0) {
    return { check, status: "pass", matched: [] };
  }
  if (check.onlyWhenChanged && check.onlyWhenChanged.length > 0) {
    const triggered = check.onlyWhenChanged.some((pattern) => matchAny(changedFiles, pattern).length > 0);
    if (!triggered) {
      return { check, status: "skipped", matched: [] };
    }
  }
  const available = mode === "all" ? patterns : patterns.slice();
  const matched: string[] = [];
  const missing: string[] = [];
  if (mode === "all") {
    for (const pattern of available) {
      const results = matchAny(matchSet, pattern);
      if (results.length === 0) {
        missing.push(pattern);
      } else {
        matched.push(...results);
      }
    }
    if (missing.length > 0) {
      return { check, status: "fail", matched, missing };
    }
    return { check, status: "pass", matched };
  }
  // mode === "any"
  for (const pattern of available) {
    const results = matchAny(matchSet, pattern);
    if (results.length > 0) {
      matched.push(...results);
    } else {
      missing.push(pattern);
    }
  }
  if (matched.length === 0) {
    return { check, status: check.optional ? "skipped" : "fail", matched, missing };
  }
  return { check, status: "pass", matched };
}

async function readLabels(): Promise<string[]> {
  const labels = new Set<string>();
  const envLabels = splitList(process.env.DOD_LABELS);
  envLabels.forEach((label) => labels.add(label));

  const githubLabelsRaw = process.env.GITHUB_LABELS || process.env.GITHUB_PR_LABELS;
  splitList(githubLabelsRaw).forEach((label) => labels.add(label));

  if (process.env.GITHUB_EVENT_PATH) {
    try {
      const payloadRaw = await fs.readFile(process.env.GITHUB_EVENT_PATH, "utf8");
      const payload = JSON.parse(payloadRaw);
      const prLabels = payload?.pull_request?.labels || payload?.issue?.labels || [];
      for (const l of prLabels) {
        if (typeof l === "string") {
          labels.add(l);
        } else if (l && typeof l.name === "string") {
          labels.add(l.name);
        }
      }
    } catch {
      // ignore event parsing errors
    }
  }

  const gitlabLabels = splitList(process.env.CI_MERGE_REQUEST_LABELS);
  gitlabLabels.forEach((label) => labels.add(label));

  return Array.from(labels);
}

function normaliseId(value: string): string {
  return value.replace(/\.ya?ml$/i, "").replace(/^dod-/, "").trim();
}

async function getForcedIds(): Promise<Set<string>> {
  const forced = new Set<string>();
  const rawValues = [
    ...splitList(process.env.DOD_APPLY),
    ...splitList(process.env.DOD_FORCE),
    ...splitList(process.env.DOD_FILES)
  ];
  for (const raw of rawValues) {
    const id = normaliseId(raw);
    if (id) forced.add(id);
  }
  return forced;
}

function selectDefinitions(
  definitions: DodDefinition[],
  labels: string[],
  forcedIds: Set<string>
): DodDefinition[] {
  const labelSet = new Set(labels.map((label) => label.toLowerCase()));
  const selected: DodDefinition[] = [];
  for (const def of definitions) {
    const defId = String(def.id || "").trim();
    const normalizedId = defId.toLowerCase();
    const matchesLabel = (def.labels || []).some((label) => labelSet.has(label.toLowerCase()));
    const forced = forcedIds.has(normalizedId);
    if (matchesLabel || forced) {
      selected.push(def);
    }
  }
  return selected;
}

async function main(): Promise<void> {
  const definitions = await loadDefinitions();
  const labels = await readLabels();
  const forcedIds = await getForcedIds();
  const activeDefinitions = selectDefinitions(definitions, labels, forcedIds);

  if (activeDefinitions.length === 0) {
    console.log("No Definition of Done files matched the current labels.");
    return;
  }

  const changedList = await getChangedFiles();
  const trackedList = await getTrackedFiles();
  const changedFiles = new Set(changedList.map(normalizePath));
  const trackedFiles = new Set(trackedList.map(normalizePath));

  const failures: { definition: DodDefinition; result: CheckResult }[] = [];
  const summaries: string[] = [];

  for (const def of activeDefinitions) {
    const checkResults: CheckResult[] = [];
    for (const check of def.checks ?? []) {
      const result = evaluateCheck(check, changedFiles, trackedFiles);
      checkResults.push(result);
      if (result.status === "fail") {
        failures.push({ definition: def, result });
      }
    }
    const passedCount = checkResults.filter((r) => r.status === "pass").length;
    const skippedCount = checkResults.filter((r) => r.status === "skipped").length;
    summaries.push(
      `${def.name || def.id}: ${passedCount} passed, ${skippedCount} skipped, ${checkResults.length - passedCount - skippedCount} failed`
    );
  }

  summaries.forEach((summary) => console.log(summary));

  if (failures.length > 0) {
    console.error("\nDefinition of Done requirements not met:");
    for (const failure of failures) {
      const { definition, result } = failure;
      console.error(`- ${definition.name || definition.id} :: ${result.check.id}`);
      console.error(`  ${result.check.description}`);
      if (result.missing && result.missing.length > 0) {
        console.error(`  Missing patterns: ${result.missing.join(", ")}`);
      }
    }
    process.exitCode = 1;
    return;
  }
  console.log("All Definition of Done requirements satisfied.");
}

main().catch((err) => {
  console.error("DoD check failed:", err);
  process.exitCode = 1;
});
