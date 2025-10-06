import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";

export interface RuleManifestEntry {
  file: string;
  effective_from: string;
  effective_to: string | null;
  source_url: string;
  version: string;
  sha256: string;
}

let cachedManifest: RuleManifestEntry[] | null = null;
let cachedSha: string | null = null;

function rulesManifestPath() {
  return path.join(process.cwd(), "app", "rules", "manifest.json");
}

export async function loadRulesManifest(): Promise<RuleManifestEntry[]> {
  if (cachedManifest) return cachedManifest;
  const file = await fs.readFile(rulesManifestPath(), "utf8");
  cachedManifest = JSON.parse(file);
  return cachedManifest;
}

export async function rulesManifestSha(): Promise<string> {
  if (cachedSha) return cachedSha;
  const manifest = await loadRulesManifest();
  const json = JSON.stringify(manifest);
  cachedSha = crypto.createHash("sha256").update(json).digest("hex");
  return cachedSha;
}

export function clearRulesManifestCache() {
  cachedManifest = null;
  cachedSha = null;
}
