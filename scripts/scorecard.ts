import fs from "fs";
import path from "path";
import process from "process";
import { spawnSync } from "child_process";

const CWD = process.cwd();

const SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  ".next",
  "coverage",
  ".turbo",
  "__pycache__",
  ".venv",
  "scan_api_out",
]);

const SOURCE_EXTS = new Set([".ts", ".tsx", ".js", ".jsx"]);

interface MetricResult {
  value: boolean | number;
  details: string;
  status: "ok" | "fail" | "warn";
  formattedValue: string;
}

interface RouteInfo {
  file: string;
  method: string;
  path: string;
  requiresMfa: boolean;
  risky: boolean;
  line: number;
}

interface MockOccurrence {
  file: string;
  line: number;
  snippet: string;
}

function readFileSafe(file: string): string | null {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

function collectFiles(root: string, exts: Set<string>): string[] {
  const results: string[] = [];
  if (!fs.existsSync(root)) return results;

  const entries = fs.readdirSync(root, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith(".")) {
      if (entry.name !== "." && entry.name !== ".." && SKIP_DIRS.has(entry.name)) {
        continue;
      }
    }
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      results.push(...collectFiles(fullPath, exts));
    } else if (entry.isFile()) {
      if (exts.has(path.extname(entry.name))) {
        results.push(fullPath);
      }
    }
  }
  return results;
}

function computeSmokePass(): MetricResult {
  const phaseReport = path.join(CWD, "phase_report.md");
  const contents = readFileSafe(phaseReport);
  if (!contents) {
    return {
      value: false,
      status: "fail",
      formattedValue: "❌ Missing",
      details: "phase_report.md not found",
    };
  }

  const phaseLines = contents
    .split(/\r?\n/)
    .filter((line) => /^\|\s*Phase/.test(line));

  const failing: string[] = [];
  for (const line of phaseLines) {
    const match = line.match(/\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|/);
    if (!match) continue;
    const phase = match[1].trim();
    const statusRaw = match[2].trim();
    if (phase.toLowerCase() === "phase" || statusRaw.toLowerCase() === "status") {
      continue;
    }
    const status = statusRaw.toUpperCase();
    if (!status || !(status === "OK" || status === "PASS" || status === "GREEN")) {
      failing.push(`${phase}: ${status || "UNKNOWN"}`);
    }
  }

  const ok = failing.length === 0 && phaseLines.length > 0;
  return {
    value: ok,
    status: ok ? "ok" : "fail",
    formattedValue: ok ? "✅ PASS" : "❌ FAIL",
    details: ok
      ? `phase_report.md (${phaseLines.length} phases)`
      : `Failing phases: ${failing.join(", ") || "none listed"}`,
  };
}

function hasKeyDeep(obj: unknown, key: string): boolean {
  if (Array.isArray(obj)) {
    return obj.some((item) => hasKeyDeep(item, key));
  }
  if (obj && typeof obj === "object") {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      const val = (obj as Record<string, unknown>)[key];
      if (val !== undefined && val !== null && val !== "") {
        return true;
      }
    }
    for (const value of Object.values(obj)) {
      if (hasKeyDeep(value, key)) return true;
    }
  }
  return false;
}

function hasReceiptId(obj: unknown): boolean {
  if (Array.isArray(obj)) {
    return obj.some((item) => hasReceiptId(item));
  }
  if (obj && typeof obj === "object") {
    const record = obj as Record<string, unknown>;
    if (Object.prototype.hasOwnProperty.call(record, "receipt")) {
      const receipt = record["receipt"];
      if (receipt && typeof receipt === "object") {
        const recObj = receipt as Record<string, unknown>;
        if (Object.prototype.hasOwnProperty.call(recObj, "id")) {
          const val = recObj["id"];
          if (val !== undefined && val !== null && val !== "") {
            return true;
          }
        }
      }
    }
    for (const value of Object.values(record)) {
      if (hasReceiptId(value)) return true;
    }
  }
  return false;
}

function computeEvidenceComplete(): MetricResult {
  const candidates = fs
    .readdirSync(CWD)
    .filter((name) => name.startsWith("evidence_") && name.endsWith(".json"))
    .map((name) => path.join(CWD, name));

  if (!candidates.length) {
    return {
      value: false,
      status: "fail",
      formattedValue: "❌ Missing",
      details: "No evidence_*.json bundles found",
    };
  }

  const sorted = candidates
    .map((file) => ({ file, mtime: fs.statSync(file).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  const bundlePath = sorted[0].file;
  const text = readFileSafe(bundlePath);
  if (!text) {
    return {
      value: false,
      status: "fail",
      formattedValue: "❌ Missing",
      details: `Failed to read ${path.basename(bundlePath)}`,
    };
  }

  try {
    const data: any = JSON.parse(text);
    const missing: string[] = [];
    if (!hasKeyDeep(data, "rates_version")) missing.push("rates_version");
    if (!hasKeyDeep(data, "merkle_root")) missing.push("merkle_root");
    if (!hasKeyDeep(data, "running_hash")) missing.push("running_hash");

    const rpt = data?.rpt as Record<string, unknown> | undefined;
    const rptSignature =
      rpt && Object.prototype.hasOwnProperty.call(rpt, "signature")
        ? (rpt["signature"] as unknown)
        : undefined;
    if (
      !rpt ||
      rptSignature === undefined ||
      rptSignature === null ||
      rptSignature === ""
    ) {
      missing.push("rpt.signature");
    }

    if (!hasReceiptId(data)) missing.push("receipt.id");

    const ok = missing.length === 0;
    return {
      value: ok,
      status: ok ? "ok" : "fail",
      formattedValue: ok ? "✅ Complete" : "❌ Incomplete",
      details: ok
        ? `${path.basename(bundlePath)}`
        : `Missing ${missing.join(", ")} in ${path.basename(bundlePath)}`,
    };
  } catch (err) {
    return {
      value: false,
      status: "fail",
      formattedValue: "❌ Invalid",
      details: `Failed to parse ${path.basename(bundlePath)}: ${(err as Error).message}`,
    };
  }
}

function countMockImports(): { count: number; occurrences: MockOccurrence[] } {
  const dirs = ["src", "apps", "components"];
  const occurrences: MockOccurrence[] = [];
  let count = 0;

  for (const dir of dirs) {
    const absolute = path.join(CWD, dir);
    if (!fs.existsSync(absolute)) continue;
    const files = collectFiles(absolute, SOURCE_EXTS);
    for (const file of files) {
      const content = readFileSafe(file);
      if (!content || !content.includes("mockData")) continue;
      const lines = content.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!line.includes("mockData")) continue;
        if (/import\s+/.test(line) || /require\s*\(/.test(line)) {
          count += 1;
          if (occurrences.length < 5) {
            occurrences.push({
              file: path.relative(CWD, file),
              line: i + 1,
              snippet: line.trim(),
            });
          }
        }
      }
    }
  }

  return { count, occurrences };
}

function extractRoutes(file: string, content: string): RouteInfo[] {
  const routes: RouteInfo[] = [];
  const callRegex = /\b([A-Za-z0-9_$]+)\.(get|post|put|delete|patch)\s*\(/g;

  let match: RegExpExecArray | null;
  while ((match = callRegex.exec(content)) !== null) {
    const receiver = match[1];
    if (!/^(?:app|router|.*Router$|.*router$|.*Api$|.*API$|.*api$)$/.test(receiver)) {
      continue;
    }
    const method = match[2].toUpperCase();
    let idx = callRegex.lastIndex;
    while (idx < content.length && /\s/.test(content[idx])) idx += 1;
    if (idx >= content.length) break;
    const quote = content[idx];
    if (quote !== '"' && quote !== "'" && quote !== "`") {
      continue;
    }
    idx += 1;
    let pathValue = "";
    while (idx < content.length) {
      const ch = content[idx];
      if (ch === "\\") {
        pathValue += ch;
        idx += 2;
        continue;
      }
      if (ch === quote) break;
      pathValue += ch;
      idx += 1;
    }
    if (idx >= content.length) break;
    idx += 1; // skip closing quote
    let depth = 1;
    const argStart = idx;
    while (idx < content.length && depth > 0) {
      const ch = content[idx];
      if (ch === "(") {
        depth += 1;
        idx += 1;
        continue;
      }
      if (ch === ")") {
        depth -= 1;
        idx += 1;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === "`") {
        const q = ch;
        idx += 1;
        while (idx < content.length) {
          const c2 = content[idx];
          if (c2 === "\\") {
            idx += 2;
            continue;
          }
          if (c2 === q) {
            idx += 1;
            break;
          }
          idx += 1;
        }
        continue;
      }
      if (ch === "/" && content[idx + 1] === "*") {
        idx += 2;
        while (idx < content.length && !(content[idx] === "*" && content[idx + 1] === "/")) {
          idx += 1;
        }
        idx += 2;
        continue;
      }
      if (ch === "/" && content[idx + 1] === "/") {
        idx += 2;
        while (idx < content.length && content[idx] !== "\n") idx += 1;
        continue;
      }
      idx += 1;
    }
    const argEnd = idx - 1;
    const args = content.slice(argStart, Math.max(argStart, argEnd)).trim();
    const startIndex = match.index || 0;
    const line = content.slice(0, startIndex).split(/\r?\n/).length;
    const requiresMfa = /mfa/i.test(args) || /requireMfa/.test(args) || /mfaGate/.test(args) || /rptGate/.test(args);
    const risky = method !== "GET";
    routes.push({
      file,
      method,
      path: pathValue,
      requiresMfa,
      risky,
      line,
    });
    callRegex.lastIndex = idx;
  }

  return routes;
}

function computeAuthCoverage(): { coverage: number; total: number; withMfa: number; missing: RouteInfo[]; } {
  const dirs = ["src", "apps", "server.js", "portal-api"];
  const routes: RouteInfo[] = [];

  for (const dir of dirs) {
    const full = path.join(CWD, dir);
    if (!fs.existsSync(full)) continue;
    const stat = fs.statSync(full);
    if (stat.isFile()) {
      if (SOURCE_EXTS.has(path.extname(full))) {
        const content = readFileSafe(full);
        if (content) {
          routes.push(...extractRoutes(path.relative(CWD, full), content));
        }
      }
      continue;
    }
    const files = collectFiles(full, SOURCE_EXTS);
    for (const file of files) {
      const content = readFileSafe(file);
      if (!content) continue;
      routes.push(...extractRoutes(path.relative(CWD, file), content));
    }
  }

  const uniqueMap = new Map<string, RouteInfo>();
  for (const r of routes) {
    const key = `${r.file}:${r.method}:${r.path}`;
    if (!uniqueMap.has(key)) {
      uniqueMap.set(key, r);
    }
  }
  const uniqueRoutes = Array.from(uniqueMap.values());
  const riskyRoutes = uniqueRoutes.filter((r) => r.risky);
  const withMfa = riskyRoutes.filter((r) => r.requiresMfa).length;
  const total = riskyRoutes.length;
  const coverage = total === 0 ? 1 : withMfa / total;
  const missing = riskyRoutes.filter((r) => !r.requiresMfa);
  return { coverage, total, withMfa, missing };
}

function isGitRepo(): boolean {
  const result = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], { encoding: "utf8" });
  return result.status === 0 && result.stdout.trim() === "true";
}

function runGit(args: string[], trim = true): string {
  const result = spawnSync("git", args, { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.error?.message || `git ${args.join(" ")}`);
  }
  return trim ? result.stdout.trim() : result.stdout;
}

function detectMergeBase(): string | null {
  if (!isGitRepo()) return null;
  const candidates = ["origin/main", "origin/master", "main", "master"];
  for (const candidate of candidates) {
    const exists = spawnSync("git", ["rev-parse", "--verify", candidate], { encoding: "utf8" });
    if (exists.status === 0) {
      const mb = spawnSync("git", ["merge-base", "HEAD", candidate], { encoding: "utf8" });
      if (mb.status === 0) {
        const commit = mb.stdout.trim();
        if (commit) return commit;
      }
    }
  }
  const headParent = spawnSync("git", ["rev-parse", "HEAD^"], { encoding: "utf8" });
  if (headParent.status === 0) {
    return headParent.stdout.trim();
  }
  return null;
}

function computeRulesGuard(): MetricResult {
  if (!isGitRepo()) {
    return {
      value: true,
      status: "warn",
      formattedValue: "⚠️ No git",
      details: "Not a git repository",
    };
  }
  const base = detectMergeBase();
  if (!base) {
    return {
      value: true,
      status: "warn",
      formattedValue: "⚠️ Unknown",
      details: "No merge base detected",
    };
  }

  let diffOutput = "";
  try {
    diffOutput = runGit(["diff", "--name-only", `${base}`, "HEAD"], false);
  } catch (err) {
    return {
      value: false,
      status: "fail",
      formattedValue: "❌ Error",
      details: (err as Error).message,
    };
  }

  const changedFiles = diffOutput
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && line.startsWith("apps/services/tax-engine/app/rules/"));

  if (changedFiles.length === 0) {
    return {
      value: true,
      status: "ok",
      formattedValue: "✅ Clean",
      details: "No rule changes detected",
    };
  }

  const offenders: string[] = [];
  for (const file of changedFiles) {
    const absolute = path.join(CWD, file);
    if (!fs.existsSync(absolute)) continue;
    const newContent = readFileSafe(absolute);
    if (newContent === null) continue;

    let oldContent: string | null = null;
    try {
      oldContent = runGit(["show", `${base}:${file}`], false);
    } catch {
      // new file — require version present but nothing to compare
      continue;
    }
    if (oldContent === null) continue;
    if (oldContent === newContent) continue;

    try {
      const oldJson = JSON.parse(oldContent);
      const newJson = JSON.parse(newContent);
      const oldVersion = oldJson?.version;
      const newVersion = newJson?.version;
      if (oldVersion === newVersion) {
        offenders.push(file);
      }
    } catch (err) {
      offenders.push(`${file} (parse error: ${(err as Error).message})`);
    }
  }

  const ok = offenders.length === 0;
  return {
    value: ok,
    status: ok ? "ok" : "fail",
    formattedValue: ok ? "✅ Guarded" : "❌ Blocked",
    details: ok
      ? `Checked ${changedFiles.length} file(s)`
      : `Missing version bump: ${offenders.join(", ")}`,
  };
}

function formatCoverage(value: number): string {
  return `${(value * 100).toFixed(0)}%`;
}

function main() {
  const smoke = computeSmokePass();
  const evidence = computeEvidenceComplete();
  const mocks = countMockImports();
  const auth = computeAuthCoverage();
  const rules = computeRulesGuard();

  const uiFormatted = mocks.count === 0 ? "✅ 0" : `❌ ${mocks.count}`;
  const uiDetails = mocks.count === 0
    ? "No mockData imports"
    : `mockData imports in ${mocks.occurrences.map((o) => `${o.file}:${o.line}`).join(", ")}${mocks.count > mocks.occurrences.length ? ", ..." : ""}`;

  const authFormatted = auth.total === 0
    ? "⚠️ N/A"
    : auth.coverage === 1
      ? `✅ ${formatCoverage(auth.coverage)}`
      : `❌ ${formatCoverage(auth.coverage)}`;
  const maxMissing = 5;
  const missingDetails = auth.missing
    .slice(0, maxMissing)
    .map((r) => `${r.method} ${r.path} (${r.file}:${r.line})`)
    .join(", ") + (auth.missing.length > maxMissing ? ", ..." : "");
  const authDetails = auth.total === 0
    ? "No risky routes detected"
    : `${auth.withMfa}/${auth.total} require MFA${missingDetails ? `; missing: ${missingDetails}` : ""}`;

  const rows: Array<{ kpi: string; status: string; value: string; details: string }> = [
    { kpi: "smoke_pass", status: smoke.formattedValue.split(" ")[0], value: smoke.formattedValue, details: smoke.details },
    { kpi: "evidence_complete", status: evidence.formattedValue.split(" ")[0], value: evidence.formattedValue, details: evidence.details },
    { kpi: "ui_mocks", status: uiFormatted.split(" ")[0], value: uiFormatted, details: uiDetails },
    { kpi: "auth_coverage", status: authFormatted.split(" ")[0], value: authFormatted, details: authDetails },
    { kpi: "rules_guard", status: rules.formattedValue.split(" ")[0], value: rules.formattedValue, details: rules.details },
  ];

  console.log("| KPI | Status | Value | Details |");
  console.log("| --- | --- | --- | --- |");
  for (const row of rows) {
    console.log(`| ${row.kpi} | ${row.status} | ${row.value} | ${row.details.replace(/\n/g, "<br/>")} |`);
  }

  if (!smoke.value) {
    process.exitCode = 1;
  }
}

main();
