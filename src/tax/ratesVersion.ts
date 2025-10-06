import fs from "fs";
import path from "path";

let cachedVersion: string | null = null;

export function getRatesVersion(): string | null {
  if (cachedVersion !== null) return cachedVersion;
  const manifestPath = path.resolve(__dirname, "../../apps/services/tax-engine/app/rules/rules_manifest.json");
  try {
    const raw = fs.readFileSync(manifestPath, "utf-8");
    const parsed = JSON.parse(raw);
    cachedVersion = parsed?.rates_version ?? null;
  } catch (err) {
    console.warn("Failed to load tax rates manifest", err);
    cachedVersion = null;
  }
  return cachedVersion;
}
