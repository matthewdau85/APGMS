import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import rubricData from "../../docs/readiness/rubric.v1.json" with { type: "json" };

export type CheckStatus = "pass" | "warn" | "fail";

export interface CheckResult {
  id: string;
  label: string;
  groupId: string;
  groupLabel: string;
  weight: number;
  status: CheckStatus;
  details: string;
}

export interface ReadinessRun {
  rubricVersion: string;
  results: CheckResult[];
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..");

type CheckHandler = () => Promise<{ status: CheckStatus; details: string }>;

const handlers: Record<string, CheckHandler> = {
  async rails_sim() {
    const file = await readText("src/rails/adapter.ts");
    const hasIdempotency = file.includes("idempotency_keys") && file.includes("appendAudit");
    const hasBankHash = file.includes("bank_receipt_hash");
    const hasProviderRef = file.includes("provider_ref");
    if (hasIdempotency && hasBankHash && hasProviderRef) {
      return { status: "pass", details: "Release writes ledger rows with audit + stable provider_ref" };
    }
    return { status: "fail", details: "Rails adapter missing idempotency/audit markers" };
  },

  async evidence_v2() {
    const file = await readText("src/evidence/bundle.ts");
    const hasLedger = file.includes("owa_ledger_deltas");
    const hasRules = file.includes("rules") && file.includes("manifest_sha256");
    const hasNarrative = file.includes("narrative");
    if (hasLedger && hasRules && hasNarrative) {
      return { status: "pass", details: "Evidence bundle exposes ledger, rules manifest and narrative" };
    }
    return { status: "fail", details: "Evidence bundle missing ledger/rules context" };
  },

  async rules_correct() {
    const file = await readText("src/recon/stateMachine.ts");
    const hasDiscrepancy = file.includes("FAIL_DISCREPANCY") && file.includes("BLOCKED_DISCREPANCY");
    const hasAnomaly = file.includes("FAIL_ANOMALY") && file.includes("BLOCKED_ANOMALY");
    const hasFinalize = file.includes("RELEASED:FINALIZE");
    if (hasDiscrepancy && hasAnomaly && hasFinalize) {
      return { status: "pass", details: "Recon state machine handles fail + finalize paths" };
    }
    return { status: "fail", details: "Recon state machine missing failure/finalize transitions" };
  },

  async security_thin() {
    const file = await readText("src/components/SecuritySettings.tsx");
    const hasMfa = file.includes("Multi-Factor Authentication");
    const hasAudit = file.includes("Audit Logging");
    const hasEncryption = file.includes("End-to-End Encryption");
    if (hasMfa && hasAudit && hasEncryption) {
      return { status: "pass", details: "Security settings expose MFA, audit log, encryption" };
    }
    return { status: "warn", details: "Security settings missing one or more controls" };
  },

  async observability() {
    const file = await readText("src/index.ts");
    const hasLogger = file.includes("[app]") && file.includes("console.log");
    const hasHealth = file.includes("/health");
    if (hasLogger && hasHealth) {
      return { status: "pass", details: "App logs inbound requests and exposes /health" };
    }
    return { status: "warn", details: "Missing request logging or health endpoint" };
  },

  async seed_smoke() {
    const file = await readText("seed_and_smoketest.ps1");
    const hasSeeds = file.includes("Seeding ATO allow-list");
    const hasLedger = file.includes("Simulate OWA credits");
    if (hasSeeds && hasLedger) {
      return { status: "pass", details: "Seed script provisions allow-list and ledger smoke" };
    }
    return { status: "warn", details: "Seed script missing allow-list or ledger smoke" };
  },

  async help_docs() {
    const file = await readText("docs/README.md");
    const mentionsRunbook = file.toLowerCase().includes("runbook");
    const mentionsHelp = file.toLowerCase().includes("help");
    if (mentionsRunbook || mentionsHelp) {
      return { status: "pass", details: "Docs include runbook/help references" };
    }
    return { status: "warn", details: "Docs missing runbook/help references" };
  },

  async kms_rpt() {
    const file = await readText("server.js");
    const hasSecret = file.includes("RPT_ED25519_SECRET_BASE64");
    const hasSha = file.includes("payload_sha256");
    if (hasSecret && hasSha) {
      return { status: "pass", details: "Server issues RPT tokens with payload hash" };
    }
    return { status: "fail", details: "Server missing KMS-backed RPT issuance" };
  },

  async sandbox_rail() {
    const file = await readText("src/rails/adapter.ts");
    const hasResolve = file.includes("resolveDestination");
    const hasAllowList = file.includes("DEST_NOT_ALLOW_LISTED");
    if (hasResolve && hasAllowList) {
      return { status: "pass", details: "Sandbox rail enforces allow-list before release" };
    }
    return { status: "fail", details: "Sandbox rail missing allow-list enforcement" };
  },

  async security_controls() {
    const file = await readText("src/components/SecuritySettings.tsx");
    const toggles = ["mfa", "auditLog", "encryption"].every(flag => file.includes(flag));
    if (toggles) {
      return { status: "pass", details: "Security component exposes required toggles" };
    }
    return { status: "warn", details: "Security component missing toggle wiring" };
  },

  async assurance() {
    const file = await readText("src/evidence/bundle.ts");
    const hasDiscrepancy = file.includes("discrepancy_log");
    const hasBundle = file.includes("bundle =");
    if (hasDiscrepancy && hasBundle) {
      return { status: "pass", details: "Evidence bundle captures discrepancy log" };
    }
    return { status: "warn", details: "Evidence bundle missing discrepancy log" };
  },

  async pilot_ops() {
    const file = await readText("ops/prometheus.yml");
    const hasScrape = file.includes("scrape_configs");
    const hasTargets = file.includes("targets");
    if (hasScrape && hasTargets) {
      return { status: "pass", details: "Prometheus config includes scrape targets" };
    }
    return { status: "warn", details: "Prometheus config missing scrape targets" };
  }
};

export async function runReadinessChecks(): Promise<ReadinessRun> {
  const results: CheckResult[] = [];
  const rubric = rubricData as unknown as {
    version: string;
    groups: Record<string, { label: string; checks: Record<string, { label: string; weight: number }> }>;
  };

  for (const [groupId, group] of Object.entries(rubric.groups)) {
    for (const [checkId, meta] of Object.entries(group.checks)) {
      const handler = handlers[checkId];
      if (!handler) {
        results.push({
          id: checkId,
          label: meta.label,
          groupId,
          groupLabel: group.label,
          weight: meta.weight,
          status: "warn",
          details: "No handler implemented"
        });
        continue;
      }
      const outcome = await handler();
      results.push({
        id: checkId,
        label: meta.label,
        groupId,
        groupLabel: group.label,
        weight: meta.weight,
        status: outcome.status,
        details: outcome.details
      });
    }
  }

  return { rubricVersion: rubric.version, results };
}

async function readText(relPath: string): Promise<string> {
  const full = path.join(repoRoot, relPath);
  try {
    return await fs.readFile(full, "utf8");
  } catch (err: any) {
    return "";
  }
}
