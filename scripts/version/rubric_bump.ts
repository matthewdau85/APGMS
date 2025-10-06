#!/usr/bin/env tsx
import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";

async function main() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const readinessDir = path.resolve(here, "../../docs/readiness");
  await fs.mkdir(readinessDir, { recursive: true });
  const entries = (await fs.readdir(readinessDir)).map((file) => ({ file, match: file.match(/^rubric\.v(\d+)\.json$/i) })).filter((x) => x.match);
  if (entries.length === 0) {
    throw new Error("No rubric files found. Create docs/readiness/rubric.v1.json first.");
  }
  entries.sort((a, b) => Number(a.match![1]) - Number(b.match![1]));
  const latest = entries[entries.length - 1];
  const currentVersion = Number(latest.match![1]);
  const nextVersion = currentVersion + 1;
  const sourcePath = path.join(readinessDir, latest.file);
  const targetName = `rubric.v${nextVersion}.json`;
  const targetPath = path.join(readinessDir, targetName);
  const raw = await fs.readFile(sourcePath, "utf8");
  const json = JSON.parse(raw);
  json.version = nextVersion;
  await fs.writeFile(targetPath, JSON.stringify(json, null, 2) + "\n", "utf8");
  console.log(`Created ${path.relative(process.cwd(), targetPath)} (based on ${latest.file})`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
