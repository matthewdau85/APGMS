import { createHash } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const repoRoot = path.resolve(__dirname, "..", "..");
const rulesDir = path.join(repoRoot, "apps/services/tax-engine/app/rules");
const manifestPath = path.join(repoRoot, "apps/services/tax-engine/app/rules_manifest.json");
const versionFile = path.join(rulesDir, "version.py");

function extractRatesVersion(source: string): string {
  const match = source.match(/RATES_VERSION\s*=\s*["']([^"']+)["']/);
  if (!match) {
    throw new Error("Unable to find RATES_VERSION in version.py");
  }
  return match[1];
}

async function sha256(filePath: string): Promise<string> {
  const buf = await fs.readFile(filePath);
  const hash = createHash("sha256");
  hash.update(buf);
  return hash.digest("hex");
}

async function loadJson(filePath: string): Promise<Record<string, any>> {
  const data = await fs.readFile(filePath, "utf8");
  return JSON.parse(data);
}

(async () => {
  const versionSource = await fs.readFile(versionFile, "utf8");
  const ratesVersion = extractRatesVersion(versionSource);

  const entries = await fs.readdir(rulesDir);
  const files = entries
    .filter((name) => name.endsWith(".json"))
    .map((name) => path.join(rulesDir, name));

  const manifestFiles = [] as Array<{
    name: string;
    sha256: string;
    last_reviewed: string | null;
    source_url: string | null;
  }>;

  for (const file of files) {
    const name = path.basename(file);
    const hash = await sha256(file);
    let lastReviewed: string | null = null;
    let sourceUrl: string | null = null;
    try {
      const payload = await loadJson(file);
      const metadata = payload?.metadata ?? {};
      if (metadata.last_reviewed) lastReviewed = String(metadata.last_reviewed);
      if (metadata.source_url) sourceUrl = String(metadata.source_url);
    } catch (error) {
      console.warn(`Warning: unable to parse ${name}:`, error);
    }
    manifestFiles.push({
      name,
      sha256: hash,
      last_reviewed: lastReviewed,
      source_url: sourceUrl,
    });
  }

  manifestFiles.sort((a, b) => a.name.localeCompare(b.name));

  let generatedAt = new Date().toISOString();
  try {
    const current = JSON.parse(await fs.readFile(manifestPath, "utf8"));
    const sameVersion = current?.rates_version === ratesVersion;
    const sameFiles = JSON.stringify(current?.files ?? []) === JSON.stringify(manifestFiles);
    if (sameVersion && sameFiles && typeof current?.generated_at === "string") {
      generatedAt = current.generated_at;
    }
  } catch {
    // no existing manifest or unreadable; fall back to fresh timestamp
  }

  const manifest = {
    generated_at: generatedAt,
    rates_version: ratesVersion,
    files: manifestFiles,
  };

  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
  console.log(`Wrote ${path.relative(repoRoot, manifestPath)}`);
})();
