import fs from "node:fs";
import path from "node:path";
import { runChecksForCategory, summarizeResults, ReadinessCheckResult } from "./checks";

type CategoryName = "prototype" | "real";

type Rubric = {
  version: string;
  prototype: {
    weights: Record<string, number>;
    thresholds: { pass: number; max: number };
  };
  real: {
    weights: Record<string, number>;
    thresholds: { pass: number; max: number };
  };
};

type CategoryReport = {
  score: number;
  max: number;
  passThreshold: number;
  checks: ReadinessCheckResult[];
};

type PersistedSnapshot = {
  rubric: { version: string };
  generatedAt: string;
  appMode: string;
  prototype: CategoryReport & { delta?: number };
  real: CategoryReport & { delta?: number };
  previous?: {
    generatedAt?: string;
    prototypeScore?: number;
    realScore?: number;
  };
};

const cwd = process.cwd();
const rubricPath = path.resolve(cwd, "docs", "readiness", "rubric.v1.json");
const artifactsDir = path.resolve(cwd, "artifacts", "readiness");
const reportPath = path.join(artifactsDir, "report.md");
const lastPath = path.join(artifactsDir, "last.json");

function ensureArtifactsDir() {
  fs.mkdirSync(artifactsDir, { recursive: true });
}

function loadRubric(): Rubric {
  const raw = fs.readFileSync(rubricPath, "utf8");
  return JSON.parse(raw);
}

async function buildCategory(
  category: CategoryName,
  rubric: Rubric,
  lite: boolean
): Promise<CategoryReport> {
  const weights = rubric[category].weights;
  const checks = await runChecksForCategory(category, weights, {
    baseUrl: process.env.READINESS_BASE_URL,
    env: process.env,
    lite,
  });
  const { score, max } = summarizeResults(checks);
  return {
    score,
    max,
    passThreshold: rubric[category].thresholds.pass,
    checks,
  };
}

function toMarkdown(category: string, report: CategoryReport): string {
  const header = `### ${category} (${report.score}/${report.max})`;
  const rows = report.checks
    .map((check) => {
      const status = check.ok ? "✅" : check.points > 0 ? "⚠️" : "❌";
      const details = check.details.replace(/\n+/g, " ");
      return `| ${check.key} | ${status} | ${check.points} | ${check.maxPoints} | ${details} |`;
    })
    .join("\n");
  return `${header}\n| Check | Status | Points | Max | Details |\n| --- | --- | --- | --- | --- |\n${rows}`;
}

function formatDelta(current: number, previous?: number): number | undefined {
  if (typeof previous !== "number") return undefined;
  return Number((current - previous).toFixed(2));
}

function writeReportMarkdown(payload: PersistedSnapshot) {
  const lines: string[] = [];
  lines.push(`# Readiness Scorecard (v${payload.rubric.version})`);
  lines.push("");
  lines.push(`Generated: ${payload.generatedAt}`);
  lines.push(`App Mode: ${payload.appMode}`);
  lines.push("");
  lines.push(toMarkdown("Prototype", payload.prototype));
  lines.push("");
  lines.push(toMarkdown("Real", payload.real));
  lines.push("");
  const protoStatus = payload.prototype.score >= payload.prototype.passThreshold ? "PASS" : "FAIL";
  const realStatus = payload.real.score >= payload.real.passThreshold ? "PASS" : "FAIL";
  lines.push(
    `**Prototype:** ${protoStatus} (threshold ${payload.prototype.passThreshold}) | **Real:** ${realStatus} (threshold ${payload.real.passThreshold})`
  );
  fs.writeFileSync(reportPath, lines.join("\n"));
}

function loadPreviousSnapshot(): PersistedSnapshot["previous"] | undefined {
  try {
    const raw = fs.readFileSync(lastPath, "utf8");
    const parsed = JSON.parse(raw);
    const prototypeScore = parsed?.prototype?.score;
    const realScore = parsed?.real?.score;
    if (typeof prototypeScore === "number" && typeof realScore === "number") {
      return {
        generatedAt: parsed.generatedAt,
        prototypeScore,
        realScore,
      };
    }
    return undefined;
  } catch {
    return undefined;
  }
}

async function main() {
  ensureArtifactsDir();
  const rubric = loadRubric();
  const previous = loadPreviousSnapshot();
  const prototype = await buildCategory("prototype", rubric, false);
  const real = await buildCategory("real", rubric, false);
  const now = new Date().toISOString();
  const appMode = process.env.APP_MODE ?? "prototype";
  const prototypeDelta = formatDelta(prototype.score, previous?.prototypeScore);
  const realDelta = formatDelta(real.score, previous?.realScore);
  const snapshot: PersistedSnapshot = {
    rubric: { version: rubric.version },
    generatedAt: now,
    appMode,
    prototype: { ...prototype, delta: prototypeDelta },
    real: { ...real, delta: realDelta },
    previous,
  };
  fs.writeFileSync(lastPath, JSON.stringify(snapshot, null, 2));
  writeReportMarkdown(snapshot);
  process.stdout.write(`Prototype score: ${prototype.score}/${prototype.max}\n`);
  process.stdout.write(`Real score: ${real.score}/${real.max}\n`);
}

main().catch((error) => {
  console.error("readiness:score failed", error);
  process.exitCode = 1;
});

