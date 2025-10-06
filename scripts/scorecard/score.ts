import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { runPrototypeChecks, runRealChecks, StageConfig, CheckResult } from "./checks";

interface StageSummary {
  score: number;
  maxScore: number;
  passThreshold: number;
  results: CheckResult[];
}

interface Rubric {
  version: string;
  prototype: StageConfig;
  real: StageConfig;
}

interface LastSnapshot {
  version: string;
  generatedAt: string;
  prototypeScore: number;
  realScore: number;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");
const rubricPath = path.join(repoRoot, "docs/readiness/rubric.v1.json");
const artifactsDir = path.join(repoRoot, "artifacts", "readiness");
const reportPath = path.join(artifactsDir, "report.md");
const lastPath = path.join(artifactsDir, "last.json");

async function loadRubric(): Promise<Rubric> {
  const raw = await fs.readFile(rubricPath, "utf-8");
  return JSON.parse(raw) as Rubric;
}

function sumPoints(results: CheckResult[]): number {
  return results.reduce((acc, item) => acc + item.points, 0);
}

function renderMarkdown(version: string, prototype: StageSummary, real: StageSummary, deltas: { prototype: number; real: number }): string {
  const formatRow = (stage: "Prototype" | "Real", result: CheckResult) => {
    const status = result.ok ? "✅" : result.points > 0 ? "⚠️" : "❌";
    const points = `${result.points.toFixed(2)}/${result.maxPoints}`;
    return `| ${stage} | ${result.key} | ${status} | ${points} | ${result.details.replace(/\n/g, "<br />")} |`;
  };

  const protoRows = prototype.results.map((res) => formatRow("Prototype", res)).join("\n");
  const realRows = real.results.map((res) => formatRow("Real", res)).join("\n");

  return `# Readiness Scorecard (v${version})\n\n` +
    `**Prototype:** ${prototype.score.toFixed(2)} / ${prototype.maxScore} (Δ ${deltas.prototype >= 0 ? "+" : ""}${deltas.prototype.toFixed(2)})\n\n` +
    `**Real:** ${real.score.toFixed(2)} / ${real.maxScore} (Δ ${deltas.real >= 0 ? "+" : ""}${deltas.real.toFixed(2)})\n\n` +
    `| Track | Check | Status | Points | Details |\n| --- | --- | --- | --- | --- |\n` +
    `${protoRows}${protoRows && realRows ? "\n" : ""}${realRows}\n`;
}

async function writeReport(markdown: string) {
  await fs.mkdir(artifactsDir, { recursive: true });
  await fs.writeFile(reportPath, markdown, "utf-8");
}

async function loadLast(): Promise<LastSnapshot | null> {
  try {
    const raw = await fs.readFile(lastPath, "utf-8");
    return JSON.parse(raw) as LastSnapshot;
  } catch {
    return null;
  }
}

async function writeLast(snapshot: LastSnapshot & { prototypeResults: CheckResult[]; realResults: CheckResult[] }) {
  const payload = {
    version: snapshot.version,
    generatedAt: snapshot.generatedAt,
    prototypeScore: snapshot.prototypeScore,
    realScore: snapshot.realScore,
    prototypeResults: snapshot.prototypeResults,
    realResults: snapshot.realResults,
  };
  await fs.writeFile(lastPath, JSON.stringify(payload, null, 2), "utf-8");
}

async function main() {
  const rubric = await loadRubric();
  const [prototypeResults, realResults] = await Promise.all([
    runPrototypeChecks(rubric.prototype),
    runRealChecks(rubric.real),
  ]);

  const prototypeScore = sumPoints(prototypeResults);
  const realScore = sumPoints(realResults);
  const prototypeMax = rubric.prototype.thresholds.max;
  const realMax = rubric.real.thresholds.max;

  const last = await loadLast();
  const deltaPrototype = last ? prototypeScore - last.prototypeScore : 0;
  const deltaReal = last ? realScore - last.realScore : 0;

  const prototypeSummary: StageSummary = {
    score: prototypeScore,
    maxScore: prototypeMax,
    passThreshold: rubric.prototype.thresholds.pass,
    results: prototypeResults,
  };

  const realSummary: StageSummary = {
    score: realScore,
    maxScore: realMax,
    passThreshold: rubric.real.thresholds.pass,
    results: realResults,
  };

  const markdown = renderMarkdown(rubric.version, prototypeSummary, realSummary, {
    prototype: deltaPrototype,
    real: deltaReal,
  });

  await writeReport(markdown);
  const summaryPath = path.join(artifactsDir, "summary.json");
  await writeLast({
    version: rubric.version,
    generatedAt: new Date().toISOString(),
    prototypeScore,
    realScore,
    prototypeResults,
    realResults,
  });

  const summary = {
    version: rubric.version,
    prototype: {
      score: prototypeScore,
      max: prototypeMax,
      threshold: rubric.prototype.thresholds.pass,
      delta: deltaPrototype,
      results: prototypeResults,
    },
    real: {
      score: realScore,
      max: realMax,
      threshold: rubric.real.thresholds.pass,
      delta: deltaReal,
      results: realResults,
    },
    artifacts: {
      report: path.relative(repoRoot, reportPath),
      last: path.relative(repoRoot, lastPath),
      summary: path.relative(repoRoot, summaryPath),
    },
  };

  await fs.writeFile(summaryPath, JSON.stringify(summary, null, 2), "utf-8");

  console.log(JSON.stringify(summary, null, 2));
  console.log(`prototypeScore/${prototypeMax}: ${prototypeScore.toFixed(2)}`);
  console.log(`realScore/${realMax}: ${realScore.toFixed(2)}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
