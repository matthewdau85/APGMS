import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { exec as execCb } from "node:child_process";

const exec = promisify(execCb);

export type ReadinessCategory = "prototype" | "real";

export interface CheckContextBase {
  baseUrl?: string;
  env?: NodeJS.ProcessEnv;
  lite?: boolean;
  logger?: (message: string) => void;
}

export interface IndividualCheckContext extends CheckContextBase {
  key: string;
  maxPoints: number;
}

export interface ReadinessCheckResult {
  key: string;
  ok: boolean;
  points: number;
  maxPoints: number;
  details: string;
}

export type ReadinessCheck = (ctx: IndividualCheckContext) => Promise<ReadinessCheckResult>;

interface HttpResponse<T = unknown> {
  ok: boolean;
  status: number;
  data?: T;
  error?: string;
}

async function safeFetchJson<T = unknown>(ctx: CheckContextBase, pathname: string, init?: RequestInit): Promise<HttpResponse<T>> {
  if (!ctx.baseUrl) {
    return { ok: false, status: 0, error: "READINESS_BASE_URL not configured" };
  }
  if (typeof fetch !== "function") {
    return { ok: false, status: 0, error: "fetch API unavailable in this runtime" };
  }
  const url = new URL(pathname, ctx.baseUrl);
  try {
    const res = await fetch(url, init);
    const text = await res.text();
    let data: T | undefined;
    try {
      data = text ? JSON.parse(text) : undefined;
    } catch {
      data = undefined as unknown as T;
    }
    return { ok: res.ok, status: res.status, data };
  } catch (error: any) {
    return { ok: false, status: 0, error: error?.message ?? String(error) };
  }
}

function success(ctx: IndividualCheckContext, details: string, points?: number): ReadinessCheckResult {
  return {
    key: ctx.key,
    ok: true,
    points: points ?? ctx.maxPoints,
    maxPoints: ctx.maxPoints,
    details,
  };
}

function failure(ctx: IndividualCheckContext, details: string, points = 0): ReadinessCheckResult {
  return {
    key: ctx.key,
    ok: false,
    points,
    maxPoints: ctx.maxPoints,
    details,
  };
}

async function ensureScriptAvailable(relative: string): Promise<boolean> {
  try {
    const stat = await fs.promises.stat(relative);
    return stat.isFile();
  } catch {
    return false;
  }
}

async function runCommand(command: string): Promise<{ ok: boolean; output: string }> {
  try {
    const { stdout, stderr } = await exec(command, { stdio: "pipe" });
    const output = [stdout, stderr].filter(Boolean).join("\n").trim();
    return { ok: true, output };
  } catch (error: any) {
    return { ok: false, output: error?.stdout || error?.stderr || error?.message || String(error) };
  }
}

function envFlag(env: NodeJS.ProcessEnv | undefined, key: string): boolean {
  if (!env) return false;
  const value = env[key];
  if (!value) return false;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function envText(env: NodeJS.ProcessEnv | undefined, key: string): string | undefined {
  return env?.[key];
}

const readinessChecks: Record<string, ReadinessCheck> = {
  "prototype.rails_sim": async (ctx) => {
    if (ctx.lite) {
      const canPing = await safeFetchJson(ctx, "/sim/rail");
      if (canPing.ok) {
        return success(ctx, "Rails simulator reachable (lite mode)", ctx.maxPoints - 1);
      }
      return failure(ctx, `Rails simulator unreachable in lite mode: ${canPing.error || canPing.status}`);
    }
    const sim = await safeFetchJson(ctx, "/sim/rail");
    if (!sim.ok) {
      return failure(ctx, `GET /sim/rail failed (${sim.status}): ${sim.error ?? "no body"}`);
    }
    const settle = await safeFetchJson(ctx, "/settlement/import", { method: "POST" });
    if (!settle.ok) {
      return failure(ctx, `POST /settlement/import failed (${settle.status}): ${settle.error ?? "no body"}`);
    }
    return success(ctx, "Rails simulator happy path succeeded");
  },
  "prototype.evidence_v2": async (ctx) => {
    const periodId = envText(ctx.env, "READINESS_PERIOD_ID") ?? "latest";
    const res = await safeFetchJson<any>(ctx, `/evidence/${periodId}`);
    if (!res.ok) {
      return failure(ctx, `Unable to fetch evidence for ${periodId}: ${res.error ?? res.status}`);
    }
    const payload = res.data ?? {};
    const manifest = payload?.rules?.manifest_sha256;
    const providerRef = payload?.settlement?.provider_ref;
    const approvals = Array.isArray(payload?.approvals) ? payload.approvals.length : 0;
    const narrative = typeof payload?.narrative === "string" ? payload.narrative.trim() : "";
    const missing: string[] = [];
    if (!manifest) missing.push("rules.manifest_sha256");
    if (!providerRef) missing.push("settlement.provider_ref");
    if (approvals === 0) missing.push("approvals[]");
    if (!narrative) missing.push("narrative");
    if (missing.length > 0) {
      return failure(ctx, `Evidence bundle missing fields: ${missing.join(", ")}`);
    }
    return success(ctx, `Evidence bundle contains manifest ${manifest} and ${approvals} approvals`);
  },
  "prototype.rules_correct": async (ctx) => {
    const ratesVersion = envText(ctx.env, "RATES_VERSION");
    const manifestSha = envText(ctx.env, "RULES_MANIFEST_SHA256");
    const golden = envFlag(ctx.env, "PAYGW_GST_GOLDEN_GREEN");
    const missing: string[] = [];
    if (!golden) missing.push("PAYGW/GST golden tests");
    if (!ratesVersion) missing.push("RATES_VERSION");
    if (!manifestSha) missing.push("RULES_MANIFEST_SHA256");
    if (missing.length > 0) {
      return failure(ctx, `Rules correctness gaps: ${missing.join(", ")}`);
    }
    return success(ctx, `Golden tests green with rates ${ratesVersion}`);
  },
  "prototype.security_thin": async (ctx) => {
    const jwt = envFlag(ctx.env, "RELEASE_REQUIRES_JWT");
    const mfa = envFlag(ctx.env, "REAL_MODE_REQUIRES_MFA");
    const dual = Number(envText(ctx.env, "RELEASE_APPROVALS_REQUIRED") ?? "0");
    const missing: string[] = [];
    if (!jwt) missing.push("/release without JWT");
    if (!mfa) missing.push("real mode MFA");
    if (!(dual >= 2)) missing.push("dual approval");
    if (missing.length > 0) {
      return failure(ctx, `Security controls missing: ${missing.join(", ")}`);
    }
    return success(ctx, "Prototype release controls enforced");
  },
  "prototype.observability": async (ctx) => {
    const health = await safeFetchJson(ctx, "/healthz");
    const metrics = await safeFetchJson(ctx, "/metrics");
    const xRequestId = envFlag(ctx.env, "OBS_REQUIRE_X_REQUEST_ID");
    if (!health.ok || !metrics.ok || !xRequestId) {
      const issues = [
        !health.ok ? "healthz" : undefined,
        !metrics.ok ? "metrics" : undefined,
        !xRequestId ? "x-request-id" : undefined,
      ].filter(Boolean);
      return failure(ctx, `Observability gaps: ${issues.join(", ") || "unknown"}`);
    }
    return success(ctx, "Observability endpoints and headers configured");
  },
  "prototype.seed_smoke": async (ctx) => {
    const seedExists = await ensureScriptAvailable(path.join("scripts", "seed"));
    const smokeExists = await ensureScriptAvailable(path.join("scripts", "smoke"));
    if (!seedExists || !smokeExists) {
      const missing = [];
      if (!seedExists) missing.push("scripts/seed");
      if (!smokeExists) missing.push("scripts/smoke");
      return failure(ctx, `Seed/smoke tooling missing: ${missing.join(", ")}`);
    }
    if (!ctx.lite) {
      const run = envFlag(ctx.env, "READINESS_EXECUTE_SEED_SMOKE");
      if (run) {
        const seedRun = await runCommand("npm run seed").catch(() => ({ ok: false, output: "npm run seed failed" } as any));
        const smokeRun = await runCommand("npm run smoke").catch(() => ({ ok: false, output: "npm run smoke failed" } as any));
        if (!seedRun.ok || !smokeRun.ok) {
          const output = [seedRun.output, smokeRun.output].filter(Boolean).join(" | ");
          return failure(ctx, `Seed/smoke execution failed: ${output}`);
        }
      }
    }
    return success(ctx, "Seed and smoke tooling present");
  },
  "prototype.help_docs": async (ctx) => {
    const helpScript = path.join("scripts", "help", "coverage.ts");
    const exists = await ensureScriptAvailable(helpScript);
    if (!exists) {
      return failure(ctx, "Help coverage script missing");
    }
    if (!ctx.lite && envFlag(ctx.env, "READINESS_RUN_HELP_COVERAGE")) {
      const result = await runCommand(`ts-node --transpile-only ${helpScript}`);
      if (!result.ok) {
        return failure(ctx, `Help coverage failed: ${result.output}`);
      }
    }
    return success(ctx, "Help documentation checks available");
  },
  "real.kms_rpt": async (ctx) => {
    const kms = envText(ctx.env, "KMS_KEY_ID");
    const rptKms = envText(ctx.env, "RPT_KMS_KEY_ID");
    const rotationFile = path.join("artifacts", "kms", "rotation.json");
    const health = await safeFetchJson<any>(ctx, "/rpt/health");
    const rotationExists = await fs.promises
      .stat(rotationFile)
      .then((stat) => stat.isFile())
      .catch(() => false);
    const missing: string[] = [];
    if (!kms || !rptKms) missing.push("env KMS keys");
    if (!rotationExists) missing.push("rotation artifact");
    if (!health.ok || !(health.data as any)?.kms) missing.push("/rpt/health kms:true");
    if (missing.length > 0) {
      return failure(ctx, `KMS readiness gaps: ${missing.join(", ")}`);
    }
    return success(ctx, "KMS keys configured and healthy");
  },
  "real.sandbox_rail": async (ctx) => {
    const mtlsCert = envText(ctx.env, "SANDBOX_MTLS_CERT");
    const mtlsKey = envText(ctx.env, "SANDBOX_MTLS_KEY");
    const providerPersisted = envFlag(ctx.env, "SANDBOX_PROVIDER_PERSISTED");
    const recon = envFlag(ctx.env, "RECON_IMPORT_UPDATES");
    const missing: string[] = [];
    if (!mtlsCert || !mtlsKey) missing.push("mTLS envs");
    if (!providerPersisted) missing.push("provider_ref persistence");
    if (!recon) missing.push("recon import settlement link");
    if (missing.length > 0) {
      return failure(ctx, `Sandbox rail gaps: ${missing.join(", ")}`);
    }
    return success(ctx, "Sandbox rail parity achieved");
  },
  "real.security_controls": async (ctx) => {
    const headers = envFlag(ctx.env, "SECURITY_HEADERS_ENFORCED");
    const rateLimit = envFlag(ctx.env, "RATE_LIMIT_ENABLED");
    const redact = envFlag(ctx.env, "LOGS_REDACT_PII");
    const missing: string[] = [];
    if (!headers) missing.push("security headers");
    if (!rateLimit) missing.push("rate limit");
    if (!redact) missing.push("PII redaction");
    if (missing.length > 0) {
      return failure(ctx, `Security control gaps: ${missing.join(", ")}`);
    }
    return success(ctx, "Security controls enforced");
  },
  "real.assurance": async (ctx) => {
    const proofsDir = path.join("artifacts", "proofs");
    const required = ["vuln-scan", "ir-notes", "dr-notes"].map((name) => path.join(proofsDir, `${name}.md`));
    const missing: string[] = [];
    for (const file of required) {
      const exists = await fs.promises
        .stat(file)
        .then((stat) => stat.isFile())
        .catch(() => false);
      if (!exists) missing.push(path.basename(file));
    }
    if (missing.length > 0) {
      return failure(ctx, `Assurance artifacts missing: ${missing.join(", ")}`);
    }
    return success(ctx, "Assurance artifacts present");
  },
  "real.pilot_ops": async (ctx) => {
    const slo = await safeFetchJson<any>(ctx, "/ops/slo");
    const runbooksDir = path.join("docs", "runbooks");
    const runbooksExists = await fs.promises
      .stat(runbooksDir)
      .then((stat) => stat.isDirectory())
      .catch(() => false);
    const sloOk = slo.ok && slo.data && slo.data.p95 && slo.data.errorRate !== undefined && slo.data.dlq !== undefined;
    if (!sloOk || !runbooksExists) {
      const issues = [];
      if (!sloOk) issues.push("/ops/slo data");
      if (!runbooksExists) issues.push("runbooks");
      return failure(ctx, `Pilot ops gaps: ${issues.join(", ")}`);
    }
    return success(ctx, "Pilot ops telemetry ready");
  },
};

export async function runChecksForCategory(
  category: ReadinessCategory,
  weights: Record<string, number>,
  options: CheckContextBase = {}
): Promise<ReadinessCheckResult[]> {
  const results: ReadinessCheckResult[] = [];
  for (const [keySuffix, maxPoints] of Object.entries(weights)) {
    const fullKey = `${category}.${keySuffix}`;
    const impl = readinessChecks[fullKey];
    const ctx: IndividualCheckContext = {
      ...options,
      key: fullKey,
      maxPoints,
    };
    if (!impl) {
      results.push(failure(ctx, "Check implementation missing"));
      continue;
    }
    try {
      const result = await impl(ctx);
      results.push(result);
    } catch (error: any) {
      const message = error?.message ?? String(error);
      results.push(failure(ctx, `Unexpected error: ${message}`));
    }
  }
  return results;
}

export function summarizeResults(results: ReadinessCheckResult[]): { score: number; max: number } {
  const score = results.reduce((acc, item) => acc + item.points, 0);
  const max = results.reduce((acc, item) => acc + item.maxPoints, 0);
  return { score, max };
}

