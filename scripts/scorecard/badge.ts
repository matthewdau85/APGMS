import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";

type Summary = {
  prototype: { score: number; maxScore: number };
  real: { score: number; maxScore: number };
};

function scoreColor(score: number): string {
  if (score >= 9) return "#4c1";
  if (score >= 7) return "#97CA00";
  if (score >= 6) return "#a4a61d";
  if (score >= 4) return "#dfb317";
  if (score >= 2) return "#fe7d37";
  return "#e05d44";
}

function textWidth(text: string): number {
  return Math.round(text.length * 6.5 + 10);
}

function buildBadge(label: string, value: string, color: string): string {
  const labelWidth = textWidth(label);
  const valueWidth = textWidth(value);
  const width = labelWidth + valueWidth;
  const height = 20;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <linearGradient id="smooth" x2="0" y2="100%">
    <stop offset="0" stop-color="#bbb" stop-opacity="0.1"/>
    <stop offset="1" stop-opacity="0.1"/>
  </linearGradient>
  <mask id="round">
    <rect width="${width}" height="${height}" rx="4" fill="#fff"/>
  </mask>
  <g mask="url(#round)">
    <rect width="${labelWidth}" height="${height}" fill="#555"/>
    <rect x="${labelWidth}" width="${valueWidth}" height="${height}" fill="${color}"/>
    <rect width="${width}" height="${height}" fill="url(#smooth)"/>
  </g>
  <g fill="#fff" text-anchor="middle"
     font-family="DejaVu Sans,Verdana,Geneva,sans-serif" font-size="11">
    <text x="${labelWidth / 2}" y="15" fill="#010101" fill-opacity="0.3">${label}</text>
    <text x="${labelWidth / 2}" y="14">${label}</text>
    <text x="${labelWidth + valueWidth / 2}" y="15" fill="#010101" fill-opacity="0.3">${value}</text>
    <text x="${labelWidth + valueWidth / 2}" y="14">${value}</text>
  </g>
</svg>`;
}

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

async function loadSummary(rootDir: string): Promise<Summary | null> {
  const summaryPath = path.join(rootDir, "artifacts", "readiness", "summary.json");
  try {
    const raw = await fs.readFile(summaryPath, "utf8");
    const parsed = JSON.parse(raw);
    if (typeof parsed?.prototype?.score === "number" && typeof parsed?.real?.score === "number") {
      return {
        prototype: { score: parsed.prototype.score, maxScore: parsed.prototype.maxScore ?? 10 },
        real: { score: parsed.real.score, maxScore: parsed.real.maxScore ?? 10 },
      };
    }
  } catch {
    return null;
  }
  return null;
}

async function main(): Promise<void> {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const rootDir = path.resolve(scriptDir, "..", "..");
  const summary = await loadSummary(rootDir);
  if (!summary) {
    console.warn("readiness summary not found; generate badges skipped");
    return;
  }

  const prototypeValue = `${summary.prototype.score.toFixed(1)}/${summary.prototype.maxScore}`;
  const realValue = `${summary.real.score.toFixed(1)}/${summary.real.maxScore}`;

  const prototypeSvg = buildBadge("prototype", prototypeValue, scoreColor(summary.prototype.score));
  const realSvg = buildBadge("real", realValue, scoreColor(summary.real.score));

  const badgeDir = path.join(rootDir, "public", "badges");
  await ensureDir(badgeDir);
  await fs.writeFile(path.join(badgeDir, "prototype.svg"), prototypeSvg);
  await fs.writeFile(path.join(badgeDir, "real.svg"), realSvg);

  console.log(JSON.stringify({ prototype: prototypeValue, real: realValue }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
