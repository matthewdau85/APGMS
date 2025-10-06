import fs from "node:fs";
import path from "node:path";

type Snapshot = {
  rubric: { version: string };
  prototype: { score: number; max: number; passThreshold: number };
  real: { score: number; max: number; passThreshold: number };
};

const cwd = process.cwd();
const lastPath = path.resolve(cwd, "artifacts", "readiness", "last.json");
const badgeDir = path.resolve(cwd, "public", "badges");

function loadSnapshot(): Snapshot {
  const raw = fs.readFileSync(lastPath, "utf8");
  const parsed = JSON.parse(raw);
  return {
    rubric: parsed.rubric,
    prototype: parsed.prototype,
    real: parsed.real,
  };
}

function colorFor(score: number, pass: number): string {
  if (score >= pass) return "#2E7D32"; // green
  if (score >= pass * 0.5) return "#FFB300"; // amber
  return "#C62828"; // red
}

function generateBadge(label: string, score: number, max: number, pass: number): string {
  const text = `${score}/${max}`;
  const color = colorFor(score, pass);
  const width = 200;
  const height = 40;
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">\n  <rect width="${width}" height="${height}" fill="#2D2F36" rx="6"/>\n  <rect x="100" width="100" height="${height}" fill="${color}" rx="6"/>\n  <text x="16" y="25" fill="#FFFFFF" font-family="Verdana,Arial,sans-serif" font-size="14">${label}</text>\n  <text x="130" y="25" fill="#FFFFFF" font-family="Verdana,Arial,sans-serif" font-size="14">${text}</text>\n</svg>\n`;
}

function ensureBadgeDir() {
  fs.mkdirSync(badgeDir, { recursive: true });
}

function writeBadge(name: string, svg: string) {
  fs.writeFileSync(path.join(badgeDir, `${name}.svg`), svg, "utf8");
}

function main() {
  ensureBadgeDir();
  const snapshot = loadSnapshot();
  writeBadge(
    "prototype",
    generateBadge("Prototype", snapshot.prototype.score, snapshot.prototype.max, snapshot.prototype.passThreshold)
  );
  writeBadge("real", generateBadge("Real", snapshot.real.score, snapshot.real.max, snapshot.real.passThreshold));
  process.stdout.write("Badges generated\n");
}

main();

