import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { getReleaseByPeriod } from "../release/store.js";

const DEFAULT_MANIFEST_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../tax-engine/app/rules/manifest.json"
);

type RulesManifest = {
  version: string;
  files: Array<{ name: string; sha256: string }>;
  manifest_sha256: string;
};

async function loadManifest(): Promise<RulesManifest> {
  const manifestPath = process.env.RULES_MANIFEST_PATH ?? DEFAULT_MANIFEST_PATH;
  const data = await readFile(manifestPath, "utf8");
  return JSON.parse(data);
}

export async function buildEvidenceBundle(abn: string, taxType: string, periodId: string) {
  const release = getReleaseByPeriod(abn, taxType, periodId);
  if (!release) {
    throw new Error("Release not found for evidence bundle");
  }
  const rules = await loadManifest();
  const status = release.verified ? "RECON_OK" : "RECON_PENDING";
  const narrative = `Released because gate=${status} request=${release.requestId}`;
  return {
    rules,
    settlement: {
      rail: release.rail,
      provider_ref: release.provider_ref,
      amount_cents: release.amount_cents,
      paid_at: release.paid_at,
      simulated: release.simulated,
    },
    narrative,
    approvals: release.approvals,
  };
}
