#!/usr/bin/env tsx
import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";

interface RuleMeta {
  file: string;
  effective_from: string;
  effective_to: string | null;
  source_url: string;
  version: string;
}

async function sha256Hex(buf: Buffer | string) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

async function main() {
  const root = process.cwd();
  const rulesDir = path.join(root, "app", "rules");
  const configPath = path.join(rulesDir, "rules.config.json");
  const configRaw = await fs.readFile(configPath, "utf8");
  const config: RuleMeta[] = JSON.parse(configRaw);

  const manifest = [] as Array<RuleMeta & { sha256: string }>;

  for (const entry of config) {
    const filePath = path.join(rulesDir, entry.file);
    const fileBuf = await fs.readFile(filePath);
    const sha = await sha256Hex(fileBuf);
    manifest.push({ ...entry, sha256: sha });
  }

  manifest.sort((a, b) => a.file.localeCompare(b.file));

  const manifestPath = path.join(rulesDir, "manifest.json");
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");

  const manifestSha = await sha256Hex(Buffer.from(JSON.stringify(manifest)));
  console.log(`Wrote ${manifest.length} rules to ${path.relative(root, manifestPath)} (sha256=${manifestSha})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
