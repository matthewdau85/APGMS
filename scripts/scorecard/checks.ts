import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { spawn } from "child_process";
import crypto from "crypto";

export interface CheckResult {
  key: string;
  ok: boolean;
  details: string;
  points: number;
  maxPoints: number;
}

export interface WeightDescriptor {
  weight: number;
  description?: string;
}

export interface StageConfig {
  weights: Record<string, WeightDescriptor>;
  thresholds: { pass: number; max: number };
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");

interface CommandResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

async function runCommand(cmd: string, args: string[], cwd = repoRoot, timeoutMs = 120_000): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, env: process.env, shell: false });
    const stdout: string[] = [];
    const stderr: string[] = [];
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
    }, timeoutMs);
    child.stdout.on("data", (chunk) => stdout.push(String(chunk)));
    child.stderr.on("data", (chunk) => stderr.push(String(chunk)));
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout: stdout.join(""), stderr: stderr.join("") });
    });
  });
}

async function ripgrep(pattern: string, cwd = repoRoot): Promise<boolean> {
  const result = await runCommand("rg", ["--quiet", "-i", pattern, "."], cwd, 15_000);
  return result.code === 0;
}

async function readJsonFile<T = any>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function hashFileSha256(filePath: string): Promise<string | null> {
  try {
    const data = await fs.readFile(filePath);
    return crypto.createHash("sha256").update(data).digest("hex");
  } catch {
    return null;
  }
}

async function checkHttpEndpoint(url: string, method: string = "GET"): Promise<{ ok: boolean; status?: number; error?: string }> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5_000);
    const res = await fetch(url, { method, signal: controller.signal });
    clearTimeout(timer);
    return { ok: res.ok, status: res.status };
  } catch (error: any) {
    return { ok: false, error: String(error?.message || error) };
  }
}

function scoreFromRatio(weight: number, ratio: number): number {
  const raw = weight * Math.max(0, Math.min(1, ratio));
  return Math.round(raw * 100) / 100;
}

async function checkPrototypeRailsSim(weight: number): Promise<CheckResult> {
  const baseUrl = process.env.READINESS_BASE_URL ?? "http://localhost:3000";
  const endpoints = ["/sim/rail", "/settlement/import"];
  const results = await Promise.all(
    endpoints.map(async (endpoint) => {
      const res = await checkHttpEndpoint(`${baseUrl}${endpoint}`);
      return { endpoint, ...res };
    })
  );

  const successCount = results.filter((r) => r.ok).length;
  let ratio = successCount / endpoints.length;
  const messages: string[] = results.map((r) =>
    r.ok ? `${r.endpoint} → ${r.status}` : `${r.endpoint} ✗ ${r.error ?? `status ${r.status}`}`
  );

  if (ratio === 0) {
    const patterns = ["/sim/rail", "idempotency", "provider_ref", "recon import"];
    const patternResults = await Promise.all(patterns.map((p) => ripgrep(p)));
    const hits = patternResults.filter(Boolean).length;
    if (hits > 0) {
      ratio = (hits / patterns.length) * 0.5;
      messages.push(`offline fallback: matched ${hits}/${patterns.length} implementation keywords`);
    } else {
      messages.push("offline fallback: no implementation keywords detected");
    }
  }

  const points = scoreFromRatio(weight, ratio);
  const ok = points >= weight;
  return {
    key: "rails_sim",
    ok,
    details: messages.join("; "),
    points,
    maxPoints: weight,
  };
}

async function checkPrototypeEvidence(weight: number): Promise<CheckResult> {
  const entries = await fs.readdir(repoRoot);
  const evidenceFiles = entries.filter((name) => name.startsWith("evidence_") && name.endsWith(".json"));
  let validCount = 0;
  const issues: string[] = [];

  for (const file of evidenceFiles) {
    const full = path.join(repoRoot, file);
    const data = await readJsonFile<Record<string, any>>(full);
    if (!data) {
      issues.push(`${file}: unreadable JSON`);
      continue;
    }
    const hasMeta = typeof data.meta === "object" && data.meta !== null;
    const hasPeriod = typeof data.period === "object" && data.period !== null;
    const hasRpt = typeof data.rpt === "object" && data.rpt !== null;
    const hasNarrative = Array.isArray(data.discrepancy_log) || Array.isArray(data.narrative);
    if (hasMeta && hasPeriod && hasRpt && hasNarrative) {
      validCount += 1;
    } else {
      issues.push(
        `${file}: missing ${[
          hasMeta ? null : "meta",
          hasPeriod ? null : "period",
          hasRpt ? null : "rpt",
          hasNarrative ? null : "narrative/discrepancy_log",
        ]
          .filter(Boolean)
          .join(", ")}`
      );
    }
  }

  const ratio = evidenceFiles.length ? validCount / evidenceFiles.length : 0;
  const points = scoreFromRatio(weight, ratio);
  const ok = points >= weight;
  const details = evidenceFiles.length
    ? `validated ${validCount}/${evidenceFiles.length} evidence files${issues.length ? `; ${issues.join("; ")}` : ""}`
    : "no evidence_*.json files present";

  return {
    key: "evidence_v2",
    ok,
    details,
    points,
    maxPoints: weight,
  };
}

async function checkPrototypeRules(weight: number): Promise<CheckResult> {
  const messages: string[] = [];
  const testResult = await runCommand("npm", ["run", "test", "--"], path.join(repoRoot, "apps/services/payments"), 180_000);
  if (testResult.code === 0) {
    messages.push("jest tests passed");
  } else {
    messages.push(`jest tests failed (code ${testResult.code})`);
    if (testResult.stderr) messages.push(testResult.stderr.trim().split("\n").slice(-3).join(" | "));
  }

  const ratesFile = await runCommand("rg", ["--files-with-matches", "RATES_VERSION", "."], repoRoot, 15_000);
  if (ratesFile.code === 0) {
    messages.push("RATES_VERSION marker found");
  } else {
    messages.push("RATES_VERSION marker missing");
  }

  const manifestSha = await hashFileSha256(path.join(repoRoot, "apps/services/payments/package-lock.json"));
  if (manifestSha) {
    messages.push(`manifest sha256 ${manifestSha.slice(0, 12)}…`);
  } else {
    messages.push("manifest hash unavailable");
  }

  let successes = 0;
  if (testResult.code === 0) successes += 1;
  if (ratesFile.code === 0) successes += 1;
  if (manifestSha) successes += 1;

  const ratio = successes / 3;
  const points = scoreFromRatio(weight, ratio);
  const ok = points >= weight;

  return {
    key: "rules_correct",
    ok,
    details: messages.join("; "),
    points,
    maxPoints: weight,
  };
}

async function checkPrototypeSecurity(weight: number): Promise<CheckResult> {
  const markers = ["jwt", "dual approval", "mfa", "roles"];
  const results = await Promise.all(markers.map((m) => ripgrep(m, repoRoot)));
  const hits = results.filter(Boolean).length;
  const ratio = hits / markers.length;
  const points = scoreFromRatio(weight, ratio);
  const ok = points >= weight;
  const details = markers
    .map((m, idx) => `${m}: ${results[idx] ? "found" : "missing"}`)
    .join("; ");
  return {
    key: "security_thin",
    ok,
    details,
    points,
    maxPoints: weight,
  };
}

async function checkPrototypeObservability(weight: number): Promise<CheckResult> {
  const hasHealth = await ripgrep("/health", path.join(repoRoot, "apps/services/payments/src"));
  const hasMetrics = await ripgrep("/metrics", repoRoot);
  const hasRequestId = await ripgrep("request-id", repoRoot);
  const ratio = [hasHealth, hasMetrics, hasRequestId].filter(Boolean).length / 3;
  const points = scoreFromRatio(weight, ratio);
  const ok = points >= weight;
  const details = `health:${hasHealth ? "✓" : "✗"}, metrics:${hasMetrics ? "✓" : "✗"}, request-id:${hasRequestId ? "✓" : "✗"}`;
  return {
    key: "observability",
    ok,
    details,
    points,
    maxPoints: weight,
  };
}

async function checkPrototypeSeedSmoke(weight: number): Promise<CheckResult> {
  const seedScriptExists = await fs
    .access(path.join(repoRoot, "seed_and_smoketest.ps1"))
    .then(() => true)
    .catch(() => false);
  const smokeScriptExists = await fs
    .access(path.join(repoRoot, "Fix-Stack-And-Smoke.ps1"))
    .then(() => true)
    .catch(() => false);

  const ratio = [seedScriptExists, smokeScriptExists].filter(Boolean).length / 2;
  const points = scoreFromRatio(weight, ratio);
  const ok = points >= weight;
  const details = `seed script: ${seedScriptExists ? "present" : "missing"}; smoke script: ${smokeScriptExists ? "present" : "missing"}`;

  return {
    key: "seed_smoke",
    ok,
    details,
    points,
    maxPoints: weight,
  };
}

async function checkPrototypeHelpDocs(weight: number): Promise<CheckResult> {
  const helpComponent = await fs
    .access(path.join(repoRoot, "src/pages/Help.tsx"))
    .then(() => true)
    .catch(() => false);
  const docsDir = await fs
    .access(path.join(repoRoot, "docs"))
    .then(() => true)
    .catch(() => false);

  const ratio = [helpComponent, docsDir].filter(Boolean).length / 2;
  const points = scoreFromRatio(weight, ratio);
  const ok = points >= weight;
  const details = `help component: ${helpComponent ? "present" : "missing"}; docs directory: ${docsDir ? "present" : "missing"}`;

  return {
    key: "help_docs",
    ok,
    details,
    points,
    maxPoints: weight,
  };
}

async function checkRealKms(weight: number): Promise<CheckResult> {
  const kmsDir = path.join(repoRoot, "apps/services/payments/src/kms");
  const kmsFiles = await fs
    .readdir(kmsDir)
    .catch(() => [])
    .then((entries) => entries.filter((name) => name.endsWith(".ts")));
  const rotationArtifactExists = await fs
    .access(path.join(repoRoot, "artifacts", "kms", "rotation.json"))
    .then(() => true)
    .catch(() => false);
  const kidMatches = await ripgrep("kid", kmsDir);
  const ratio = [kmsFiles.length > 0, rotationArtifactExists, kidMatches].filter(Boolean).length / 3;
  const points = scoreFromRatio(weight, ratio);
  const ok = points >= weight;
  const details = `kms files: ${kmsFiles.length}; rotation artifact: ${rotationArtifactExists ? "present" : "missing"}; kid keyword: ${kidMatches ? "found" : "missing"}`;
  return {
    key: "kms_rpt",
    ok,
    details,
    points,
    maxPoints: weight,
  };
}

async function checkRealSandboxRail(weight: number): Promise<CheckResult> {
  const mtls = await ripgrep("mTLS", repoRoot);
  const sandbox = await ripgrep("sandbox", repoRoot);
  const receipts = await ripgrep("receipt", repoRoot);
  const ratio = [mtls, sandbox, receipts].filter(Boolean).length / 3;
  const points = scoreFromRatio(weight, ratio);
  const ok = points >= weight;
  const details = `mTLS:${mtls ? "✓" : "✗"}; sandbox:${sandbox ? "✓" : "✗"}; receipts:${receipts ? "✓" : "✗"}`;
  return {
    key: "sandbox_rail",
    ok,
    details,
    points,
    maxPoints: weight,
  };
}

async function checkRealSecurityControls(weight: number): Promise<CheckResult> {
  const markers = ["MFA", "dual approval", "rate limit", "security header"];
  const results = await Promise.all(markers.map((m) => ripgrep(m, repoRoot)));
  const ratio = results.filter(Boolean).length / markers.length;
  const points = scoreFromRatio(weight, ratio);
  const ok = points >= weight;
  const details = markers
    .map((m, idx) => `${m}: ${results[idx] ? "found" : "missing"}`)
    .join("; ");
  return {
    key: "security_controls",
    ok,
    details,
    points,
    maxPoints: weight,
  };
}

async function checkRealAssurance(weight: number): Promise<CheckResult> {
  const markers = ["drift", "vuln", "incident", "disaster"];
  const results = await Promise.all(markers.map((m) => ripgrep(m, repoRoot)));
  const ratio = results.filter(Boolean).length / markers.length;
  const points = scoreFromRatio(weight, ratio);
  const ok = points >= weight;
  const details = markers
    .map((m, idx) => `${m}: ${results[idx] ? "found" : "missing"}`)
    .join("; ");
  return {
    key: "assurance",
    ok,
    details,
    points,
    maxPoints: weight,
  };
}

async function checkRealPilotOps(weight: number): Promise<CheckResult> {
  const markers = ["SLO", "DLQ", "proofs", "/proofs"];
  const results = await Promise.all(markers.map((m) => ripgrep(m, repoRoot)));
  const ratio = results.filter(Boolean).length / markers.length;
  const points = scoreFromRatio(weight, ratio);
  const ok = points >= weight;
  const details = markers
    .map((m, idx) => `${markers[idx]}: ${results[idx] ? "found" : "missing"}`)
    .join("; ");
  return {
    key: "pilot_ops",
    ok,
    details,
    points,
    maxPoints: weight,
  };
}

export async function runPrototypeChecks(config: StageConfig): Promise<CheckResult[]> {
  return [
    await checkPrototypeRailsSim(config.weights["rails_sim"].weight),
    await checkPrototypeEvidence(config.weights["evidence_v2"].weight),
    await checkPrototypeRules(config.weights["rules_correct"].weight),
    await checkPrototypeSecurity(config.weights["security_thin"].weight),
    await checkPrototypeObservability(config.weights["observability"].weight),
    await checkPrototypeSeedSmoke(config.weights["seed_smoke"].weight),
    await checkPrototypeHelpDocs(config.weights["help_docs"].weight),
  ];
}

export async function runRealChecks(config: StageConfig): Promise<CheckResult[]> {
  return [
    await checkRealKms(config.weights["kms_rpt"].weight),
    await checkRealSandboxRail(config.weights["sandbox_rail"].weight),
    await checkRealSecurityControls(config.weights["security_controls"].weight),
    await checkRealAssurance(config.weights["assurance"].weight),
    await checkRealPilotOps(config.weights["pilot_ops"].weight),
  ];
}
