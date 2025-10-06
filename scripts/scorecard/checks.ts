import fs from "fs";
import path from "path";

export interface CheckResult {
  key: string;
  ok: boolean;
  details: string;
  helpUrl?: string;
}

export interface ScorecardSnapshot {
  score: number;
  max: number;
  checks: CheckResult[];
}

export interface ReadinessSnapshot {
  rubric: { version: string };
  prototype: ScorecardSnapshot;
  real: ScorecardSnapshot;
  timestamp: string;
  appMode: string;
}

type Mode = "lite" | "full";

type CheckDefinition = {
  key: string;
  helpUrl?: string;
  requiresFull?: boolean;
  run: (ctx: CheckContext) => Promise<Omit<CheckResult, "key">> | Omit<CheckResult, "key">;
};

interface CheckContext {
  mode: Mode;
  repoRoot: string;
}

const RUBRIC_VERSION = "1.0";
const repoRoot = path.resolve(__dirname, "..", "..");

const HELP_LINKS = {
  taxEngine: "https://github.com/apgms/docs/wiki/Tax-Engine",
  normalizer: "https://github.com/apgms/docs/wiki/Event-Normalizer",
  schema: "https://github.com/apgms/docs/wiki/Payroll-Event-Schema",
  pytest: "https://github.com/apgms/docs/wiki/Python-Test-Suite",
  docker: "https://github.com/apgms/docs/wiki/Docker",
  platformEnv: "https://github.com/apgms/docs/wiki/Platform-Configuration",
  observability: "https://github.com/apgms/docs/wiki/Observability",
  runbooks: "https://github.com/apgms/docs/wiki/Runbooks",
};

function fileExists(relPath: string): boolean {
  const fullPath = path.join(repoRoot, relPath);
  try {
    fs.accessSync(fullPath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function readFile(relPath: string): string | null {
  const fullPath = path.join(repoRoot, relPath);
  try {
    return fs.readFileSync(fullPath, "utf8");
  } catch {
    return null;
  }
}

function evaluate(defs: CheckDefinition[], ctx: CheckContext): ScorecardSnapshot {
  const checks: CheckResult[] = defs.map((def) => {
    if (ctx.mode === "lite" && def.requiresFull) {
      return {
        key: def.key,
        ok: false,
        details: "Requires full mode to evaluate (skipped in lite mode)",
        helpUrl: def.helpUrl,
      };
    }

    try {
      const result = def.run(ctx);
      if (result instanceof Promise) {
        throw new Error("Async checks are not supported in this environment");
      }
      return {
        key: def.key,
        ok: result.ok,
        details: result.details,
        helpUrl: result.helpUrl ?? def.helpUrl,
      };
    } catch (error) {
      return {
        key: def.key,
        ok: false,
        details: error instanceof Error ? error.message : String(error),
        helpUrl: def.helpUrl,
      };
    }
  });

  const score = checks.filter((check) => check.ok).length;
  const max = checks.length;
  return { score, max, checks };
}

const prototypeCheckDefinitions: CheckDefinition[] = [
  {
    key: "tax-engine-init",
    helpUrl: HELP_LINKS.taxEngine,
    run: () => {
      const ok = fileExists("apps/services/tax-engine/app/__init__.py");
      return {
        ok,
        details: ok
          ? "apps/services/tax-engine/app/__init__.py present"
          : "Missing apps/services/tax-engine/app/__init__.py",
      };
    },
  },
  {
    key: "tax-engine-main",
    helpUrl: HELP_LINKS.taxEngine,
    run: () => {
      const ok = fileExists("apps/services/tax-engine/app/main.py");
      return {
        ok,
        details: ok
          ? "apps/services/tax-engine/app/main.py present"
          : "Missing apps/services/tax-engine/app/main.py",
      };
    },
  },
  {
    key: "tax-rules-gst",
    helpUrl: HELP_LINKS.taxEngine,
    run: () => {
      const content = readFile("apps/services/tax-engine/app/tax_rules.py");
      const ok = !!content && /def\s+gst_line_tax\s*\(/.test(content);
      return {
        ok,
        details: ok
          ? "gst_line_tax function defined"
          : "gst_line_tax function missing in tax_rules.py",
      };
    },
  },
  {
    key: "tax-rules-paygw",
    helpUrl: HELP_LINKS.taxEngine,
    run: () => {
      const content = readFile("apps/services/tax-engine/app/tax_rules.py");
      const ok = !!content && /def\s+paygw_weekly\s*\(/.test(content);
      return {
        ok,
        details: ok
          ? "paygw_weekly function defined"
          : "paygw_weekly function missing in tax_rules.py",
      };
    },
  },
  {
    key: "normalizer-init",
    helpUrl: HELP_LINKS.normalizer,
    run: () => {
      const ok = fileExists("apps/services/event-normalizer/app/__init__.py");
      return {
        ok,
        details: ok
          ? "apps/services/event-normalizer/app/__init__.py present"
          : "Missing apps/services/event-normalizer/app/__init__.py",
      };
    },
  },
  {
    key: "normalizer-main",
    helpUrl: HELP_LINKS.normalizer,
    run: () => {
      const ok = fileExists("apps/services/event-normalizer/app/main.py");
      return {
        ok,
        details: ok
          ? "apps/services/event-normalizer/app/main.py present"
          : "Missing apps/services/event-normalizer/app/main.py",
      };
    },
  },
  {
    key: "schema-present",
    helpUrl: HELP_LINKS.schema,
    run: () => {
      const ok = fileExists("libs/json/payroll_event.v1.json");
      return {
        ok,
        details: ok
          ? "libs/json/payroll_event.v1.json present"
          : "Missing libs/json/payroll_event.v1.json",
      };
    },
  },
  {
    key: "schema-tfn-required",
    helpUrl: HELP_LINKS.schema,
    run: () => {
      const content = readFile("libs/json/payroll_event.v1.json");
      if (!content) {
        return {
          ok: false,
          details: "Unable to read libs/json/payroll_event.v1.json",
        };
      }
      try {
        const schema = JSON.parse(content);
        const required: string[] = Array.isArray(schema?.required)
          ? schema.required
          : [];
        const ok = required.includes("employee_tax_file_number");
        return {
          ok,
          details: ok
            ? "Schema requires employee_tax_file_number"
            : "Schema missing employee_tax_file_number in required[]",
        };
      } catch (error) {
        return {
          ok: false,
          details: error instanceof Error ? error.message : String(error),
        };
      }
    },
  },
  {
    key: "pytest-config",
    helpUrl: HELP_LINKS.pytest,
    run: () => {
      const ok = fileExists("pytest.ini");
      return {
        ok,
        details: ok ? "pytest.ini present" : "Missing pytest.ini",
      };
    },
  },
  {
    key: "docker-compose",
    helpUrl: HELP_LINKS.docker,
    run: () => {
      const ok = fileExists("docker-compose.yml");
      return {
        ok,
        details: ok ? "docker-compose.yml present" : "Missing docker-compose.yml",
      };
    },
  },
];

const realCheckDefinitions: CheckDefinition[] = [
  {
    key: "env-database-url",
    helpUrl: HELP_LINKS.platformEnv,
    run: () => {
      const ok = Boolean(process.env.DATABASE_URL);
      return {
        ok,
        details: ok
          ? "DATABASE_URL configured"
          : "DATABASE_URL environment variable not set",
      };
    },
  },
  {
    key: "env-ed25519-private",
    helpUrl: HELP_LINKS.platformEnv,
    run: () => {
      const ok = Boolean(process.env.ED25519_PRIVATE_BASE64);
      return {
        ok,
        details: ok
          ? "ED25519_PRIVATE_BASE64 configured"
          : "ED25519_PRIVATE_BASE64 environment variable not set",
      };
    },
  },
  {
    key: "env-ed25519-public",
    helpUrl: HELP_LINKS.platformEnv,
    run: () => {
      const ok = Boolean(process.env.ED25519_PUBLIC_BASE64);
      return {
        ok,
        details: ok
          ? "ED25519_PUBLIC_BASE64 configured"
          : "ED25519_PUBLIC_BASE64 environment variable not set",
      };
    },
  },
  {
    key: "env-app-mode",
    helpUrl: HELP_LINKS.platformEnv,
    run: () => {
      const mode = process.env.APP_MODE ?? "prototype";
      const ok = mode === "real" || mode === "prototype";
      return {
        ok,
        details: ok
          ? `APP_MODE set to ${mode}`
          : "APP_MODE must be 'prototype' or 'real'",
      };
    },
  },
  {
    key: "ops-prometheus-config",
    helpUrl: HELP_LINKS.observability,
    run: () => {
      const ok = fileExists("ops/prometheus.yml");
      return {
        ok,
        details: ok
          ? "ops/prometheus.yml present"
          : "Missing ops/prometheus.yml",
      };
    },
  },
  {
    key: "ops-otel-config",
    helpUrl: HELP_LINKS.observability,
    run: () => {
      const ok = fileExists("ops/otel-config.yaml");
      return {
        ok,
        details: ok
          ? "ops/otel-config.yaml present"
          : "Missing ops/otel-config.yaml",
      };
    },
  },
  {
    key: "ops-grafana-dashboards",
    helpUrl: HELP_LINKS.observability,
    run: () => {
      const dashboardsDir = path.join(repoRoot, "ops", "grafana", "dashboards");
      const ok = fs.existsSync(dashboardsDir) && fs.readdirSync(dashboardsDir).length > 0;
      return {
        ok,
        details: ok
          ? "Grafana dashboards configured"
          : "ops/grafana/dashboards is missing or empty",
      };
    },
  },
  {
    key: "ops-runbooks",
    helpUrl: HELP_LINKS.runbooks,
    run: () => {
      const runbooksDir = path.join(repoRoot, "ops", "runbooks");
      const ok = fs.existsSync(runbooksDir) && fs.readdirSync(runbooksDir).length > 0;
      return {
        ok,
        details: ok
          ? "Runbooks repository populated"
          : "ops/runbooks is missing or empty",
      };
    },
  },
  {
    key: "docker-compose-metrics",
    helpUrl: HELP_LINKS.docker,
    run: () => {
      const ok = fileExists("docker-compose.metrics.yml");
      return {
        ok,
        details: ok
          ? "docker-compose.metrics.yml present"
          : "Missing docker-compose.metrics.yml",
      };
    },
  },
  {
    key: "docker-compose-override",
    helpUrl: HELP_LINKS.docker,
    run: () => {
      const ok = fileExists("docker-compose.override.yml");
      return {
        ok,
        details: ok
          ? "docker-compose.override.yml present"
          : "Missing docker-compose.override.yml",
      };
    },
  },
];

export function runScorecard(options?: { mode?: Mode }): ReadinessSnapshot {
  const mode = options?.mode ?? "full";
  const ctx: CheckContext = { mode, repoRoot };

  const prototype = evaluate(prototypeCheckDefinitions, ctx);
  const real = evaluate(realCheckDefinitions, ctx);

  return {
    rubric: { version: RUBRIC_VERSION },
    prototype,
    real,
    timestamp: new Date().toISOString(),
    appMode: process.env.APP_MODE ?? (process.env.NODE_ENV ?? "prototype"),
  };
}

export function runScorecardLite(): ReadinessSnapshot {
  return runScorecard({ mode: "lite" });
}
