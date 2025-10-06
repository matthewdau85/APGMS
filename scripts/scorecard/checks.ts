import { promises as fs } from "fs";
import path from "path";

export type ReadinessMode = "prototype" | "real";

export interface ReadinessCheckResult {
  key: string;
  label: string;
  mode: ReadinessMode;
  ok: boolean;
  details: string;
  helpUrl?: string;
}

export interface ReadinessScorecard {
  score: number;
  max: number;
  checks: ReadinessCheckResult[];
}

interface CheckDefinition {
  key: string;
  label: string;
  mode: ReadinessMode;
  helpUrl?: string;
  run: (context: { lite: boolean }) => Promise<{ ok: boolean; details: string }>;
}

const REPO_ROOT = process.env.APGMS_REPO_ROOT || process.cwd();

async function pathExists(relativePath: string): Promise<boolean> {
  try {
    await fs.access(path.resolve(REPO_ROOT, relativePath));
    return true;
  } catch {
    return false;
  }
}

function envFlagTrue(name: string): boolean {
  const raw = process.env[name];
  if (!raw) return false;
  return raw.trim().toLowerCase() === "true";
}

const prototypeChecks: CheckDefinition[] = [
  {
    key: "prototype-event-normalizer",
    label: "Event normalizer service available",
    mode: "prototype",
    helpUrl: "https://intranet.apgms.example/runbooks/event-normalizer",
    run: async () => {
      const exists = await pathExists("apps/services/event-normalizer");
      return {
        ok: exists,
        details: exists
          ? "Service folder present in repository"
          : "Missing event-normalizer service directory",
      };
    },
  },
  {
    key: "prototype-payments-build",
    label: "Payments service source tracked",
    mode: "prototype",
    helpUrl: "https://intranet.apgms.example/runbooks/payments-prototype",
    run: async () => {
      const exists = await pathExists("apps/services/payments/package.json");
      return {
        ok: exists,
        details: exists
          ? "package.json found for payments service"
          : "Payments package.json missing",
      };
    },
  },
  {
    key: "prototype-recon-job",
    label: "Reconciliation job defined",
    mode: "prototype",
    helpUrl: "https://intranet.apgms.example/runbooks/recon-prototype",
    run: async () => {
      const exists = await pathExists("apps/services/recon");
      return {
        ok: exists,
        details: exists
          ? "Recon service sources present"
          : "Recon service directory missing",
      };
    },
  },
  {
    key: "prototype-rpt-verify",
    label: "Reporting verification scripts available",
    mode: "prototype",
    helpUrl: "https://intranet.apgms.example/runbooks/rpt-verify",
    run: async () => {
      const exists = await pathExists("apps/services/rpt-verify");
      return {
        ok: exists,
        details: exists
          ? "rpt-verify service folder present"
          : "rpt-verify service missing",
      };
    },
  },
  {
    key: "prototype-bank-egress",
    label: "Bank egress integration committed",
    mode: "prototype",
    helpUrl: "https://intranet.apgms.example/runbooks/bank-egress",
    run: async () => {
      const exists = await pathExists("apps/services/bank-egress");
      return {
        ok: exists,
        details: exists
          ? "bank-egress service present"
          : "bank-egress service missing",
      };
    },
  },
  {
    key: "prototype-grafana-dashboards",
    label: "Grafana dashboards checked in",
    mode: "prototype",
    helpUrl: "https://intranet.apgms.example/observability/grafana",
    run: async () => {
      const exists = await pathExists("ops/grafana/dashboards");
      return {
        ok: exists,
        details: exists
          ? "Grafana dashboards directory present"
          : "Grafana dashboards directory missing",
      };
    },
  },
  {
    key: "prototype-prometheus-rules",
    label: "Prometheus config versioned",
    mode: "prototype",
    helpUrl: "https://intranet.apgms.example/observability/prometheus",
    run: async () => {
      const exists = await pathExists("ops/prometheus.yml");
      return {
        ok: exists,
        details: exists
          ? "ops/prometheus.yml found"
          : "Prometheus config missing",
      };
    },
  },
  {
    key: "prototype-otel-config",
    label: "OTel collector config committed",
    mode: "prototype",
    helpUrl: "https://intranet.apgms.example/observability/otel",
    run: async () => {
      const exists = await pathExists("ops/otel-config.yaml");
      return {
        ok: exists,
        details: exists
          ? "ops/otel-config.yaml available"
          : "OTel collector config missing",
      };
    },
  },
  {
    key: "prototype-bcp-drill",
    label: "BCP drill completed",
    mode: "prototype",
    helpUrl: "https://intranet.apgms.example/bcp/runbook",
    run: async () => {
      const ok = envFlagTrue("PROTOTYPE_BCP_DRILL_COMPLETE");
      return {
        ok,
        details: ok
          ? "PROTOTYPE_BCP_DRILL_COMPLETE flag set"
          : "Awaiting BCP drill completion (set PROTOTYPE_BCP_DRILL_COMPLETE=true)",
      };
    },
  },
  {
    key: "prototype-security-review",
    label: "Security review accepted",
    mode: "prototype",
    helpUrl: "https://intranet.apgms.example/security/reviews",
    run: async () => {
      const ok = envFlagTrue("PROTOTYPE_SECURITY_REVIEW_APPROVED");
      return {
        ok,
        details: ok
          ? "Prototype security review approved"
          : "Security review approval missing (set PROTOTYPE_SECURITY_REVIEW_APPROVED=true)",
      };
    },
  },
];

function formatPenTestDetails(raw: string | undefined): { ok: boolean; details: string } {
  if (!raw) {
    return {
      ok: false,
      details: "Pen test date missing (set REAL_LAST_PEN_TEST_AT=YYYY-MM-DD)",
    };
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return {
      ok: false,
      details: `Invalid pen test date '${raw}' (expected YYYY-MM-DD)`,
    };
  }

  const ageMs = Date.now() - parsed.getTime();
  const maxAgeMs = 1000 * 60 * 60 * 24 * 180; // 180 days
  const ok = ageMs <= maxAgeMs;
  if (ok) {
    return {
      ok,
      details: `Pen test completed on ${raw}`,
    };
  }

  return {
    ok,
    details: `Last pen test on ${raw} exceeds 180 day threshold`,
  };
}

const realChecks: CheckDefinition[] = [
  {
    key: "real-tax-engine",
    label: "Tax engine deployed",
    mode: "real",
    helpUrl: "https://intranet.apgms.example/runbooks/tax-engine",
    run: async () => {
      const exists = await pathExists("apps/services/tax-engine");
      return {
        ok: exists,
        details: exists
          ? "tax-engine service folder present"
          : "tax-engine service missing",
      };
    },
  },
  {
    key: "real-audit-pipeline",
    label: "Audit pipeline ready",
    mode: "real",
    helpUrl: "https://intranet.apgms.example/runbooks/audit",
    run: async () => {
      const exists = await pathExists("apps/services/audit");
      return {
        ok: exists,
        details: exists
          ? "audit service folder present"
          : "audit service missing",
      };
    },
  },
  {
    key: "real-bas-gate",
    label: "BAS gate service packaged",
    mode: "real",
    helpUrl: "https://intranet.apgms.example/runbooks/bas-gate",
    run: async () => {
      const exists = await pathExists("apps/services/bas-gate");
      return {
        ok: exists,
        details: exists
          ? "bas-gate service folder present"
          : "bas-gate service missing",
      };
    },
  },
  {
    key: "real-nginx-config",
    label: "Ingress configuration committed",
    mode: "real",
    helpUrl: "https://intranet.apgms.example/operations/nginx",
    run: async () => {
      const exists = await pathExists("ops/nginx.main.conf");
      return {
        ok: exists,
        details: exists
          ? "ops/nginx.main.conf found"
          : "NGINX config missing",
      };
    },
  },
  {
    key: "real-prometheus",
    label: "Production Prometheus config ready",
    mode: "real",
    helpUrl: "https://intranet.apgms.example/observability/prometheus",
    run: async () => {
      const exists = await pathExists("ops/prometheus.yml");
      return {
        ok: exists,
        details: exists
          ? "ops/prometheus.yml found"
          : "Prometheus config missing",
      };
    },
  },
  {
    key: "real-runbooks",
    label: "Runbooks in repository",
    mode: "real",
    helpUrl: "https://intranet.apgms.example/runbooks",
    run: async () => {
      const exists = await pathExists("ops/runbooks/README.md");
      return {
        ok: exists,
        details: exists
          ? "Runbook index present"
          : "Runbook README missing",
      };
    },
  },
  {
    key: "real-production-credentials",
    label: "Production credential rotation",
    mode: "real",
    helpUrl: "https://intranet.apgms.example/security/credentials",
    run: async () => {
      const ok = envFlagTrue("REAL_PROD_CREDENTIALS_READY");
      return {
        ok,
        details: ok
          ? "Production credentials rotated"
          : "Rotate credentials and set REAL_PROD_CREDENTIALS_READY=true",
      };
    },
  },
  {
    key: "real-penetration-test",
    label: "Recent penetration testing",
    mode: "real",
    helpUrl: "https://intranet.apgms.example/security/pen-tests",
    run: async () => formatPenTestDetails(process.env.REAL_LAST_PEN_TEST_AT),
  },
  {
    key: "real-regulator-signoff",
    label: "Regulator sign-off recorded",
    mode: "real",
    helpUrl: "https://intranet.apgms.example/compliance/regulator",
    run: async () => {
      const ok = envFlagTrue("REAL_REGULATOR_SIGNOFF");
      return {
        ok,
        details: ok
          ? "Regulator sign-off confirmed"
          : "Awaiting regulator sign-off (set REAL_REGULATOR_SIGNOFF=true)",
      };
    },
  },
  {
    key: "real-dr-exercise",
    label: "Disaster recovery exercise",
    mode: "real",
    helpUrl: "https://intranet.apgms.example/bcp/dr-plan",
    run: async () => {
      const ok = envFlagTrue("REAL_DR_EXERCISE_COMPLETE");
      return {
        ok,
        details: ok
          ? "REAL_DR_EXERCISE_COMPLETE flag set"
          : "Schedule DR exercise and set REAL_DR_EXERCISE_COMPLETE=true",
      };
    },
  },
];

const allChecks = [...prototypeChecks, ...realChecks];

export async function runScorecard(
  mode: ReadinessMode,
  options: { lite?: boolean } = {},
): Promise<ReadinessScorecard> {
  const relevant = allChecks.filter((check) => check.mode === mode);
  const lite = options.lite ?? false;
  const results: ReadinessCheckResult[] = [];

  for (const check of relevant) {
    try {
      const outcome = await check.run({ lite });
      results.push({
        key: check.key,
        label: check.label,
        mode: check.mode,
        ok: outcome.ok,
        details: outcome.details,
        helpUrl: check.helpUrl,
      });
    } catch (error) {
      const details =
        error instanceof Error ? error.message : "Unexpected error running check";
      results.push({
        key: check.key,
        label: check.label,
        mode: check.mode,
        ok: false,
        details,
        helpUrl: check.helpUrl,
      });
    }
  }

  const score = results.filter((result) => result.ok).length;
  return { score, max: results.length, checks: results };
}

export async function runAllScorecards(options: { lite?: boolean } = {}) {
  const [prototype, real] = await Promise.all([
    runScorecard("prototype", options),
    runScorecard("real", options),
  ]);

  return { prototype, real };
}
