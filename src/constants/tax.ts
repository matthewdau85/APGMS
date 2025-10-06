import fs from "node:fs";
import path from "node:path";

export type RatesManifest = {
  version: string;
  sha256: string;
  generated_at?: string;
  files?: Record<string, string>;
};

const PROJECT_ROOT = process.env.PROJECT_ROOT || path.resolve(__dirname, "..", "..");
const MANIFEST_PATH = path.join(PROJECT_ROOT, "apps/services/tax-engine/app/rules/manifest.json");

function loadManifest(): RatesManifest | undefined {
  try {
    const raw = fs.readFileSync(MANIFEST_PATH, "utf-8");
    return JSON.parse(raw) as RatesManifest;
  } catch (err) {
    if (process.env.NODE_ENV !== "production") {
      console.warn("[tax] unable to load rules manifest", err);
    }
    return undefined;
  }
}

export const RATES_VERSION = "2024-25";
export const RULES_MANIFEST: RatesManifest | undefined = loadManifest();
export const RULES_MANIFEST_SHA256 = RULES_MANIFEST?.sha256 ?? "";
