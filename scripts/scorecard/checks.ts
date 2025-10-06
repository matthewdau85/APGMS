import { execFile } from "child_process";
import { promises as fs } from "fs";
import path from "path";
import { promisify } from "util";

export interface CheckResult {
  key: string;
  ok: boolean;
  details: string;
  points: number;
  maxPoints: number;
}

export interface CheckContext {
  rootDir: string;
}

type WeightMap = Record<string, number>;

const execFileAsync = promisify(execFile);

async function fetchWithTimeout(url: string, init: any, timeoutMs = 2000): Promise<any> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function findFiles(rootDir: string, matcher: (entryPath: string, isDir: boolean) => boolean): Promise<string[]> {
  const results: string[] = [];
  const queue: string[] = [rootDir];
  const skip = new Set([".git", "node_modules", "artifacts", "public", ".venv"]);

  while (queue.length) {
    const current = queue.pop()!;
    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!skip.has(entry.name)) {
          if (matcher(entryPath, true)) {
            results.push(entryPath);
          }
          queue.push(entryPath);
        }
      } else {
        if (matcher(entryPath, false)) {
          results.push(entryPath);
        }
      }
    }
  }
  return results;
}

async function runCommand(command: string, args: string[], cwd: string): Promise<{ ok: boolean; stdout: string; stderr: string; exitCode: number }>
{
  try {
    const { stdout, stderr } = await execFileAsync(command, args, { cwd });
    return { ok: true, stdout, stderr, exitCode: 0 };
  } catch (error: any) {
    return {
      ok: false,
      stdout: error?.stdout?.toString() ?? "",
      stderr: error?.stderr?.toString() ?? String(error?.message ?? ""),
      exitCode: typeof error?.code === "number" ? error.code : 1,
    };
  }
}

function asDetails(lines: string[]): string {
  return lines.filter(Boolean).join("; ");
}

export async function runPrototypeChecks(context: CheckContext, weights: WeightMap): Promise<CheckResult[]> {
  const { rootDir } = context;
  const results: CheckResult[] = [];

  // rails_sim check
  {
    const weight = weights["rails_sim"] ?? 0;
    const endpoints: Array<{ method: string; url: string; ok: boolean; status?: number }> = [];
    if (weight > 0) {
      const targets = [
        { method: "GET", url: "http://127.0.0.1:3000/sim/rail" },
        { method: "POST", url: "http://127.0.0.1:3000/settlement/import", body: { dryRun: true } },
      ];
      for (const target of targets) {
        try {
          const res = await fetchWithTimeout(target.url, {
            method: target.method,
            headers: target.method === "POST" ? { "content-type": "application/json" } : undefined,
            body: target.body ? JSON.stringify(target.body) : undefined,
          });
          endpoints.push({ method: target.method, url: target.url, ok: res.ok, status: res.status });
        } catch (error: any) {
          endpoints.push({ method: target.method, url: target.url, ok: false });
        }
      }
    }
    const ok = weight === 0 ? true : endpoints.every((ep) => ep.ok);
    const details = weight === 0
      ? "no weight configured"
      : endpoints.length === 0
        ? "no endpoints attempted"
        : endpoints.map((ep) => `${ep.method} ${ep.url} ${ep.ok ? "ok" : "failed"}${ep.status ? ` (${ep.status})` : ""}`).join(", ");
    results.push({ key: "rails_sim", ok, details, points: ok ? weight : 0, maxPoints: weight });
  }

  // evidence_v2 check
  {
    const weight = weights["evidence_v2"] ?? 0;
    let ok = false;
    let details = "no evidence files located";
    if (weight > 0) {
      const evidenceFiles = (await findFiles(rootDir, (entryPath, isDir) => !isDir && /evidence_.*\.json$/i.test(path.basename(entryPath)))).slice(0, 5);
      if (evidenceFiles.length > 0) {
        for (const file of evidenceFiles) {
          try {
            const raw = await fs.readFile(file, "utf8");
            const parsed = JSON.parse(raw);
            const hasFields = ["rulesHash", "settlement", "narrative", "approvals"].every((key) => key in parsed);
            if (hasFields) {
              ok = true;
              details = `validated ${path.relative(rootDir, file)}`;
              break;
            }
          } catch (error: any) {
            details = `failed to parse ${path.relative(rootDir, file)}: ${error?.message ?? error}`;
          }
        }
        if (!ok && evidenceFiles.length > 0 && details === "no evidence files located") {
          details = `found ${evidenceFiles.length} evidence files but missing required fields`;
        }
      }
    } else {
      ok = true;
      details = "no weight configured";
    }
    results.push({ key: "evidence_v2", ok, details, points: ok ? weight : 0, maxPoints: weight });
  }

  // rules_correct check
  {
    const weight = weights["rules_correct"] ?? 0;
    let ok = false;
    let details: string[] = [];
    if (weight > 0) {
      const testRun = await runCommand("npm", ["run", "test", "--if-present"], rootDir);
      details.push(`npm run test --if-present exit ${testRun.exitCode}`);
      if (!testRun.ok) {
        details.push(testRun.stderr.trim() ? testRun.stderr.trim().split(/\n+/).slice(0, 2).join(" | ") : "no stderr");
      }

      const manifestPath = path.join(rootDir, "docs", "_codex_feed", "manifest.json");
      const manifestExists = await pathExists(manifestPath);
      details.push(manifestExists ? "manifest present" : "manifest missing");

      const ratesVersionSource = await findFiles(rootDir, (entryPath, isDir) => !isDir && /RATES_VERSION/i.test(path.basename(entryPath)));
      if (ratesVersionSource.length > 0) {
        details.push(`rates marker found in ${path.relative(rootDir, ratesVersionSource[0])}`);
      } else {
        details.push("RATES_VERSION not found");
      }

      ok = testRun.ok && manifestExists && ratesVersionSource.length > 0;
    } else {
      ok = true;
      details.push("no weight configured");
    }
    results.push({ key: "rules_correct", ok, details: asDetails(details), points: ok ? weight : 0, maxPoints: weight });
  }

  // security_thin check
  {
    const weight = weights["security_thin"] ?? 0;
    let ok = false;
    let details: string[] = [];
    if (weight > 0) {
      const securityFiles = await findFiles(rootDir, (entryPath, isDir) => {
        if (isDir) return false;
        const name = path.basename(entryPath).toLowerCase();
        if (!name.endsWith(".md") && !name.endsWith(".ts") && !name.endsWith(".js")) return false;
        return /mfa|dual approval|jwt|role/i.test(name) || /securitysettings/i.test(name);
      });
      if (securityFiles.length > 0) {
        ok = true;
        details.push(`found security references e.g. ${path.relative(rootDir, securityFiles[0])}`);
      } else {
        details.push("no MFA/JWT references detected");
      }
    } else {
      ok = true;
      details.push("no weight configured");
    }
    results.push({ key: "security_thin", ok, details: asDetails(details), points: ok ? weight : 0, maxPoints: weight });
  }

  // observability check
  {
    const weight = weights["observability"] ?? 0;
    let ok = false;
    let details: string[] = [];
    if (weight > 0) {
      const serverPath = path.join(rootDir, "server.js");
      if (await pathExists(serverPath)) {
        const serverSource = await fs.readFile(serverPath, "utf8");
        const hasHealth = /\/health/.test(serverSource);
        const hasMetrics = /\/metrics/.test(serverSource);
        const hasRequestId = /request-id/i.test(serverSource) || /x-request-id/i.test(serverSource);
        ok = hasHealth && hasMetrics && hasRequestId;
        details.push(`health:${hasHealth ? "ok" : "missing"}`);
        details.push(`metrics:${hasMetrics ? "ok" : "missing"}`);
        details.push(`request-id:${hasRequestId ? "ok" : "missing"}`);
      } else {
        details.push("server.js missing");
      }
    } else {
      ok = true;
      details.push("no weight configured");
    }
    results.push({ key: "observability", ok, details: asDetails(details), points: ok ? weight : 0, maxPoints: weight });
  }

  // seed_smoke check
  {
    const weight = weights["seed_smoke"] ?? 0;
    let ok = false;
    let details: string[] = [];
    if (weight > 0) {
      const seedScript = path.join(rootDir, "seed_and_smoketest.ps1");
      const smokeScript = path.join(rootDir, "Fix-Stack-And-Smoke.ps1");
      const hasSeed = await pathExists(seedScript);
      const hasSmoke = await pathExists(smokeScript);
      ok = hasSeed && hasSmoke;
      details.push(`seed script ${hasSeed ? "present" : "missing"}`);
      details.push(`smoke script ${hasSmoke ? "present" : "missing"}`);
    } else {
      ok = true;
      details.push("no weight configured");
    }
    results.push({ key: "seed_smoke", ok, details: asDetails(details), points: ok ? weight : 0, maxPoints: weight });
  }

  // help_docs check
  {
    const weight = weights["help_docs"] ?? 0;
    let ok = false;
    let details: string[] = [];
    if (weight > 0) {
      const helpPage = path.join(rootDir, "src", "pages", "Help.tsx");
      const exists = await pathExists(helpPage);
      if (exists) {
        const contents = await fs.readFile(helpPage, "utf8");
        const hasCoverage = /coverage|support|guide/i.test(contents);
        ok = hasCoverage;
        details.push(`help page ${hasCoverage ? "contains guidance" : "missing coverage references"}`);
      } else {
        details.push("help page missing");
      }
    } else {
      ok = true;
      details.push("no weight configured");
    }
    results.push({ key: "help_docs", ok, details: asDetails(details), points: ok ? weight : 0, maxPoints: weight });
  }

  return results;
}

export async function runRealChecks(context: CheckContext, weights: WeightMap): Promise<CheckResult[]> {
  const { rootDir } = context;
  const results: CheckResult[] = [];
  const featureReal = /^true$/i.test(process.env.FEATURE_REAL ?? "");

  // kms_rpt check
  {
    const weight = weights["kms_rpt"] ?? 0;
    let ok = false;
    let details: string[] = [];
    if (weight > 0) {
      const rotationArtifacts = await findFiles(rootDir, (entryPath, isDir) => !isDir && /rotation/i.test(path.basename(entryPath)));
      const ed25519Module = path.join(rootDir, "src", "crypto", "ed25519.ts");
      const hasModule = await pathExists(ed25519Module);
      if (hasModule) {
        details.push("ed25519 module present");
      } else {
        details.push("ed25519 module missing");
      }
      if (rotationArtifacts.length > 0) {
        details.push(`rotation artifact e.g. ${path.relative(rootDir, rotationArtifacts[0])}`);
      } else {
        details.push("no rotation artifacts detected");
      }
      const envConfigured = Boolean(process.env.RPT_ED25519_SECRET_BASE64 || process.env.KMS_RPT_KEY_PATH);
      details.push(envConfigured ? "KMS env configured" : "KMS env missing");
      ok = hasModule && rotationArtifacts.length > 0 && envConfigured;
    } else {
      ok = true;
      details.push("no weight configured");
    }
    if (!featureReal && weight > 0) {
      details.push("FEATURE_REAL disabled");
    }
    results.push({ key: "kms_rpt", ok: ok && (featureReal || !weight), details: asDetails(details), points: ok ? weight : 0, maxPoints: weight });
  }

  // sandbox_rail check
  {
    const weight = weights["sandbox_rail"] ?? 0;
    let ok = false;
    let details: string[] = [];
    if (weight > 0) {
      const sandboxDocs = await findFiles(rootDir, (entryPath, isDir) => !isDir && /sandbox/i.test(path.basename(entryPath)));
      const receiptsMention = await findFiles(rootDir, (entryPath, isDir) => !isDir && /receipt/i.test(path.basename(entryPath)));
      const hasRecon = await findFiles(rootDir, (entryPath, isDir) => !isDir && /recon/i.test(path.basename(entryPath))).then((r) => r.length > 0);
      ok = sandboxDocs.length > 0 && receiptsMention.length > 0 && hasRecon;
      details.push(sandboxDocs.length > 0 ? "sandbox docs found" : "sandbox docs missing");
      details.push(receiptsMention.length > 0 ? "receipt artifacts found" : "receipt artifacts missing");
      details.push(hasRecon ? "recon artifacts present" : "recon artifacts missing");
    } else {
      ok = true;
      details.push("no weight configured");
    }
    if (!featureReal && weight > 0) {
      details.push("FEATURE_REAL disabled");
    }
    results.push({ key: "sandbox_rail", ok: ok && (featureReal || !weight), details: asDetails(details), points: ok ? weight : 0, maxPoints: weight });
  }

  // security_controls check
  {
    const weight = weights["security_controls"] ?? 0;
    let ok = false;
    let details: string[] = [];
    if (weight > 0) {
      const securitySettings = path.join(rootDir, "src", "components", "SecuritySettings.tsx");
      const releaseServer = path.join(rootDir, "server.js");
      const hasSecuritySettings = await pathExists(securitySettings);
      const releaseSource = (await pathExists(releaseServer)) ? await fs.readFile(releaseServer, "utf8") : "";
      const headersConfigured = /x-release|authorization|x-api-key/i.test(releaseSource);
      const dualApprovalMention = /dual approval/i.test(releaseSource) || /dual approval/i.test(await (async () => {
        try {
          return await fs.readFile(path.join(rootDir, "README.md"), "utf8");
        } catch {
          return "";
        }
      })());
      const mfaMention = /MFA/i.test(releaseSource) || hasSecuritySettings;
      ok = hasSecuritySettings && headersConfigured && dualApprovalMention && mfaMention;
      details.push(hasSecuritySettings ? "security settings UI present" : "security settings UI missing");
      details.push(headersConfigured ? "release headers configured" : "release headers missing");
      details.push(dualApprovalMention ? "dual approval referenced" : "dual approval missing");
      details.push(mfaMention ? "MFA referenced" : "MFA missing");
    } else {
      ok = true;
      details.push("no weight configured");
    }
    if (!featureReal && weight > 0) {
      details.push("FEATURE_REAL disabled");
    }
    results.push({ key: "security_controls", ok: ok && (featureReal || !weight), details: asDetails(details), points: ok ? weight : 0, maxPoints: weight });
  }

  // assurance check
  {
    const weight = weights["assurance"] ?? 0;
    let ok = false;
    let details: string[] = [];
    if (weight > 0) {
      const workflowPath = path.join(rootDir, ".github", "workflows");
      const hasWorkflowDir = await pathExists(workflowPath);
      const runbooks = await findFiles(path.join(rootDir, "ops"), (entryPath, isDir) => !isDir && /runbook|ir|dr/i.test(path.basename(entryPath))).catch(() => [] as string[]);
      const vulnScanScripts = await findFiles(path.join(rootDir, "tools"), (entryPath, isDir) => !isDir && /scan|audit/i.test(path.basename(entryPath))).catch(() => [] as string[]);
      ok = hasWorkflowDir && runbooks.length > 0 && vulnScanScripts.length > 0;
      details.push(hasWorkflowDir ? "CI workflows present" : "CI workflows missing");
      details.push(runbooks.length > 0 ? "IR/DR notes present" : "IR/DR notes missing");
      details.push(vulnScanScripts.length > 0 ? "scan scripts present" : "scan scripts missing");
    } else {
      ok = true;
      details.push("no weight configured");
    }
    if (!featureReal && weight > 0) {
      details.push("FEATURE_REAL disabled");
    }
    results.push({ key: "assurance", ok: ok && (featureReal || !weight), details: asDetails(details), points: ok ? weight : 0, maxPoints: weight });
  }

  // pilot_ops check
  {
    const weight = weights["pilot_ops"] ?? 0;
    let ok = false;
    let details: string[] = [];
    if (weight > 0) {
      const sloFiles = await findFiles(rootDir, (entryPath, isDir) => !isDir && /slo|dashboard/i.test(path.basename(entryPath)));
      const dlqScripts = await findFiles(rootDir, (entryPath, isDir) => !isDir && /dlq|replay/i.test(path.basename(entryPath)));
      const proofsEndpoint = await findFiles(rootDir, (entryPath, isDir) => !isDir && /proof/i.test(path.basename(entryPath)) && entryPath.endsWith(".ts"));
      ok = sloFiles.length > 0 && dlqScripts.length > 0 && proofsEndpoint.length > 0;
      details.push(sloFiles.length > 0 ? "SLO references present" : "SLO references missing");
      details.push(dlqScripts.length > 0 ? "DLQ tooling present" : "DLQ tooling missing");
      details.push(proofsEndpoint.length > 0 ? "proof endpoint present" : "proof endpoint missing");
    } else {
      ok = true;
      details.push("no weight configured");
    }
    if (!featureReal && weight > 0) {
      details.push("FEATURE_REAL disabled");
    }
    results.push({ key: "pilot_ops", ok: ok && (featureReal || !weight), details: asDetails(details), points: ok ? weight : 0, maxPoints: weight });
  }

  return results;
}
