import { promises as fs } from "fs";
import path from "path";
import { runReadinessChecks, CheckResult, CheckStatus } from "./checks";
import { renderBadge } from "./badge";

async function main() {
  const run = await runReadinessChecks();
  const results = run.results;
  const totalWeight = results.reduce((acc, r) => acc + r.weight, 0);
  const achieved = results.reduce((acc, r) => acc + scoreFor(r.status, r.weight), 0);
  const pct = totalWeight === 0 ? 0 : (achieved / totalWeight) * 100;
  const summaryStatus = summariseStatus(results);

  const lines: string[] = [];
  lines.push(`# Readiness scorecard (${run.rubricVersion})`);
  lines.push("");
  lines.push(`Overall score: **${pct.toFixed(1)}%**`);
  lines.push("");
  lines.push("| Check | Group | Weight | Status | Details |");
  lines.push("| --- | --- | --- | --- | --- |");
  for (const r of results) {
    lines.push(`| ${r.label} | ${r.groupLabel} | ${r.weight} | ${r.status.toUpperCase()} | ${escapePipes(r.details)} |`);
  }
  const report = lines.join("\n");

  const artifactsDir = path.join(process.cwd(), "artifacts", "readiness");
  await fs.mkdir(artifactsDir, { recursive: true });
  await fs.writeFile(path.join(artifactsDir, "report.md"), report, "utf8");
  await fs.writeFile(
    path.join(artifactsDir, "status.json"),
    JSON.stringify({
      rubricVersion: run.rubricVersion,
      generatedAt: new Date().toISOString(),
      results,
      totalWeight,
      achieved,
      scorePercent: pct,
      summaryStatus
    }, null, 2),
    "utf8"
  );

  const badgeDir = path.join(process.cwd(), "public", "badges");
  await fs.mkdir(badgeDir, { recursive: true });
  for (const r of results) {
    const svg = renderBadge(r.id, r.status);
    await fs.writeFile(path.join(badgeDir, `${r.id}.svg`), svg, "utf8");
  }
  const summaryBadge = renderBadge("readiness", summaryStatus, `${pct.toFixed(1)}%`);
  await fs.writeFile(path.join(badgeDir, `summary.svg`), summaryBadge, "utf8");

  for (const r of results) {
    console.log(` - [${r.status.toUpperCase()}] ${r.label} (${r.groupLabel})`);
  }
  console.log(`Overall score: ${pct.toFixed(1)}% (${summaryStatus.toUpperCase()})`);

  if (summaryStatus === "fail") {
    process.exitCode = 1;
  }
}

function scoreFor(status: CheckStatus, weight: number): number {
  if (status === "pass") return weight;
  if (status === "warn") return weight * 0.5;
  return 0;
}

function summariseStatus(results: CheckResult[]): CheckStatus {
  if (results.some(r => r.status === "fail")) return "fail";
  if (results.some(r => r.status === "warn")) return "warn";
  return "pass";
}

function escapePipes(value: string): string {
  return value.replace(/\|/g, "\\|");
}

main().catch(err => {
  console.error("Failed to compute readiness scorecard", err);
  process.exitCode = 1;
});
