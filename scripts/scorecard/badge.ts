import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";

interface LastSnapshot {
  prototypeScore: number;
  realScore: number;
  version: string;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");
const lastPath = path.join(repoRoot, "artifacts", "readiness", "last.json");
const badgesDir = path.join(repoRoot, "public", "badges");

function colorForRatio(ratio: number): string {
  if (ratio >= 0.8) return "#2e7d32"; // green
  if (ratio >= 0.6) return "#f9a825"; // yellow
  if (ratio >= 0.4) return "#f57f17"; // amber
  return "#c62828"; // red
}

function createBadgeSvg(label: string, value: string, color: string): string {
  const labelWidth = 6 * label.length + 40;
  const valueWidth = 6 * value.length + 40;
  const width = labelWidth + valueWidth;
  const height = 20;

  return `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" role="img" aria-label="${label}: ${value}">` +
    `<linearGradient id="smooth" x2="0" y2="100%"><stop offset="0" stop-color="#fff" stop-opacity=".7"/><stop offset="1" stop-opacity=".7"/></linearGradient>` +
    `<mask id="round"><rect width="${width}" height="${height}" rx="4" fill="#fff"/></mask>` +
    `<g mask="url(#round)">` +
    `<rect width="${labelWidth}" height="${height}" fill="#555"/>` +
    `<rect x="${labelWidth}" width="${valueWidth}" height="${height}" fill="${color}"/>` +
    `<rect width="${width}" height="${height}" fill="url(#smooth)"/>` +
    `</g>` +
    `<g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">` +
    `<text x="${labelWidth / 2}" y="15">${label}</text>` +
    `<text x="${labelWidth + valueWidth / 2}" y="15">${value}</text>` +
    `</g>` +
    `</svg>`;
}

async function loadLast(): Promise<LastSnapshot | null> {
  try {
    const raw = await fs.readFile(lastPath, "utf-8");
    const parsed = JSON.parse(raw);
    if (typeof parsed.prototypeScore === "number" && typeof parsed.realScore === "number") {
      return {
        prototypeScore: parsed.prototypeScore,
        realScore: parsed.realScore,
        version: parsed.version ?? "unknown",
      };
    }
    return null;
  } catch {
    return null;
  }
}

async function writeBadge(file: string, svg: string) {
  await fs.mkdir(badgesDir, { recursive: true });
  await fs.writeFile(path.join(badgesDir, file), svg, "utf-8");
}

async function main() {
  const snapshot = await loadLast();
  const prototypeScore = snapshot?.prototypeScore ?? 0;
  const realScore = snapshot?.realScore ?? 0;
  const maxPrototype = 10;
  const maxReal = 10;

  const protoRatio = maxPrototype ? prototypeScore / maxPrototype : 0;
  const realRatio = maxReal ? realScore / maxReal : 0;

  const protoSvg = createBadgeSvg(
    "prototype",
    `${prototypeScore.toFixed(1)}/${maxPrototype}`,
    colorForRatio(protoRatio)
  );
  const realSvg = createBadgeSvg(
    "real",
    `${realScore.toFixed(1)}/${maxReal}`,
    colorForRatio(realRatio)
  );

  await writeBadge("prototype.svg", protoSvg);
  await writeBadge("real.svg", realSvg);

  console.log(JSON.stringify({
    version: snapshot?.version ?? "unknown",
    prototype: { score: prototypeScore, max: maxPrototype },
    real: { score: realScore, max: maxReal },
    badges: {
      prototype: path.relative(repoRoot, path.join(badgesDir, "prototype.svg")),
      real: path.relative(repoRoot, path.join(badgesDir, "real.svg")),
    },
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
