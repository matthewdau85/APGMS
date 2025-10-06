import fs from "fs";
import path from "path";
import crypto from "crypto";

export interface RulesManifestFile {
  name: string;
  sha256: string;
}

export interface RulesManifest {
  version: string;
  generated_at: string;
  files: RulesManifestFile[];
}

function resolveManifestPath(): string {
  const explicit = process.env.RULES_MANIFEST_PATH;
  if (explicit) return explicit;
  const root = process.env.PROJECT_ROOT ?? process.cwd();
  return path.resolve(root, "apps", "services", "tax-engine", "app", "rules", "manifest.json");
}

function readManifest(): RulesManifest {
  const manifestPath = resolveManifestPath();
  const contents = fs.readFileSync(manifestPath, "utf-8");
  return JSON.parse(contents) as RulesManifest;
}

const manifest = readManifest();
const manifestPath = resolveManifestPath();
const manifestHash = crypto.createHash("sha256").update(fs.readFileSync(manifestPath)).digest("hex");

export const RULES_MANIFEST: RulesManifest = manifest;
export const RATES_VERSION = manifest.version;
export const RULES_MANIFEST_SHA256 = manifestHash;
