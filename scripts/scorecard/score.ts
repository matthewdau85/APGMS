import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { runPrototypeChecks, runRealChecks, CheckResult } from "./checks";

interface RubricTrack {
  weights: Record<string, number>;
  thresholds: { pass: number; max: number };
}

interface Rubric {
  version: string;
  prototype: RubricTrack;
  real: RubricTrack;
}

interface TrackSummary {
  score: number;
  maxScore: number;
  thresholdPass: number;
  pass: boolean;
  checks: CheckResult[];
}

interface ReportData {
  generatedAt: string;
  rubricVersion: string;
  prototype: TrackSummary;
  real: TrackSummary;
  deltaPrototype: number | null;
  deltaReal: number | null;
}

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

function computeTrackSummary(checks: CheckResult[], thresholds: { pass: number; max: number }): TrackSummary {
  const totalPoints = checks.reduce((acc, check) => acc + check.points, 0);
  const maxPoints = checks.reduce((acc, check) => acc + check.maxPoints, 0);
  const maxTarget = thresholds.max || (maxPoints === 0 ? 10 : maxPoints);
  const score = maxPoints === 0 ? 0 : Number(((totalPoints / maxPoints) * maxTarget).toFixed(2));
  const pass = score >= thresholds.pass;
  return {
    score,
    maxScore: maxTarget,
    thresholdPass: thresholds.pass,
    pass,
    checks,
  };
}

function buildMarkdown(report: ReportData): string {
  const summaryLines = [
    "# Readiness Scorecard",
    "",
    `- Generated: ${report.generatedAt}`,
    `- Rubric version: ${report.rubricVersion}`,
    "",
    "## Summary",
    "",
    "| Track | Score | Δ vs last | Pass? |",
    "| --- | --- | --- | --- |",
    `| Prototype | ${report.prototype.score.toFixed(2)} / ${report.prototype.maxScore} | ${formatDelta(report.deltaPrototype)} | ${report.prototype.pass ? "✅" : "❌"} |`,
    `| Real | ${report.real.score.toFixed(2)} / ${report.real.maxScore} | ${formatDelta(report.deltaReal)} | ${report.real.pass ? "✅" : "❌"} |`,
    "",
    "## Prototype checks",
    "",
    "| Check | Points | Status | Details |",
    "| --- | --- | --- | --- |",
    ...report.prototype.checks.map((check) =>
      `| ${check.key} | ${check.points}/${check.maxPoints} | ${check.ok ? "✅" : "❌"} | ${escapePipes(check.details)} |`
    ),
    "",
    "## Real checks",
    "",
    "| Check | Points | Status | Details |",
    "| --- | --- | --- | --- |",
    ...report.real.checks.map((check) =>
      `| ${check.key} | ${check.points}/${check.maxPoints} | ${check.ok ? "✅" : "❌"} | ${escapePipes(check.details)} |`
    ),
    "",
    "## Raw report",
    "",
    "```json",
    JSON.stringify(report, null, 2),
    "```",
    "",
  ];
  return summaryLines.join("\n");
}

function escapePipes(text: string): string {
  return text.replace(/\|/g, "\\|");
}

function formatDelta(delta: number | null): string {
  if (delta === null) return "n/a";
  const prefix = delta > 0 ? "+" : "";
  return `${prefix}${delta.toFixed(2)}`;
}

async function loadRubric(rootDir: string): Promise<Rubric> {
  const rubricPath = path.join(rootDir, "docs", "readiness", "rubric.v1.json");
  const raw = await fs.readFile(rubricPath, "utf8");
  return JSON.parse(raw) as Rubric;
}

async function readLast(lastPath: string): Promise<{ prototypeScore: number; realScore: number } | null> {
  try {
    const raw = await fs.readFile(lastPath, "utf8");
    const parsed = JSON.parse(raw);
    if (typeof parsed.prototype?.score === "number" && typeof parsed.real?.score === "number") {
      return { prototypeScore: parsed.prototype.score, realScore: parsed.real.score };
    }
    if (typeof parsed.prototypeScore === "number" && typeof parsed.realScore === "number") {
      return { prototypeScore: parsed.prototypeScore, realScore: parsed.realScore };
    }
    return null;
  } catch {
    return null;
  }
}

async function writeJson(filePath: string, data: unknown): Promise<void> {
  await fs.writeFile(filePath, JSON.stringify(data, null, 2));
}

async function main(): Promise<void> {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const rootDir = path.resolve(scriptDir, "..", "..");
  const artifactsDir = path.join(rootDir, "artifacts", "readiness");
  await ensureDir(artifactsDir);

  const rubric = await loadRubric(rootDir);
  const context = { rootDir };
  const [prototypeChecks, realChecks] = await Promise.all([
    runPrototypeChecks(context, rubric.prototype.weights),
    runRealChecks(context, rubric.real.weights),
  ]);

  const prototypeSummary = computeTrackSummary(prototypeChecks, rubric.prototype.thresholds);
  const realSummary = computeTrackSummary(realChecks, rubric.real.thresholds);

  const lastPath = path.join(artifactsDir, "last.json");
  const lastScores = await readLast(lastPath);
  const deltaPrototype = lastScores ? Number((prototypeSummary.score - lastScores.prototypeScore).toFixed(2)) : null;
  const deltaReal = lastScores ? Number((realSummary.score - lastScores.realScore).toFixed(2)) : null;

  const report: ReportData = {
    generatedAt: new Date().toISOString(),
    rubricVersion: rubric.version,
    prototype: prototypeSummary,
    real: realSummary,
    deltaPrototype,
    deltaReal,
  };

  const reportPath = path.join(artifactsDir, "report.md");
  const summaryPath = path.join(artifactsDir, "summary.json");

  await fs.writeFile(reportPath, buildMarkdown(report));
  await writeJson(summaryPath, {
    generatedAt: report.generatedAt,
    rubricVersion: report.rubricVersion,
    prototype: {
      score: prototypeSummary.score,
      maxScore: prototypeSummary.maxScore,
      pass: prototypeSummary.pass,
      delta: deltaPrototype,
    },
    real: {
      score: realSummary.score,
      maxScore: realSummary.maxScore,
      pass: realSummary.pass,
      delta: deltaReal,
    },
  });
  await writeJson(lastPath, {
    generatedAt: report.generatedAt,
    rubricVersion: report.rubricVersion,
    prototype: { score: prototypeSummary.score },
    real: { score: realSummary.score },
  });

  const consoleOutput = {
    prototypeScore: prototypeSummary.score,
    realScore: realSummary.score,
    deltaPrototype,
    deltaReal,
    report: path.relative(rootDir, reportPath),
  };

  console.log(JSON.stringify(consoleOutput, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
