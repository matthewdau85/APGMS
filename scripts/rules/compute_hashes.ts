import { promises as fs } from "fs";
import { createHash } from "crypto";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const RULES_DIR = path.join(REPO_ROOT, "apps", "services", "tax-engine", "app", "rules");
const MANIFEST_PATH = path.join(RULES_DIR, "rules_manifest.json");
const DOC_PATH = path.join(REPO_ROOT, "docs", "tax_rules_current_state.md");

interface RuleMetadata {
  name: string;
  effective_from: string | null;
  effective_to: string | null;
  last_reviewed: string | null;
  source_url: string;
}

interface ManifestFileEntry extends RuleMetadata {
  sha256: string;
}

async function listRuleFiles(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = await listRuleFiles(fullPath);
      files.push(...nested);
    } else if (entry.isFile() && entry.name.endsWith(".json")) {
      if (fullPath === MANIFEST_PATH) continue;
      files.push(fullPath);
    }
  }
  return files.sort();
}

async function computeSha256(content: Buffer): Promise<string> {
  return createHash("sha256").update(content).digest("hex");
}

async function loadMetadata(filePath: string): Promise<RuleMetadata> {
  const raw = await fs.readFile(filePath, "utf-8");
  const data = JSON.parse(raw);
  const metadata = data.metadata as Partial<RuleMetadata> | undefined;
  if (!metadata || !metadata.name || !metadata.source_url) {
    throw new Error(`Missing metadata for rule file ${filePath}`);
  }
  return {
    name: metadata.name,
    source_url: metadata.source_url,
    effective_from: metadata.effective_from ?? null,
    effective_to: metadata.effective_to ?? null,
    last_reviewed: metadata.last_reviewed ?? null,
  };
}

function relativeRulePath(filePath: string): string {
  return path.relative(RULES_DIR, filePath).replace(/\\/g, "/");
}

async function buildManifest(): Promise<{ files: ManifestFileEntry[]; generatedAt: string }> {
  const ruleFiles = await listRuleFiles(RULES_DIR);
  const files: ManifestFileEntry[] = [];
  for (const file of ruleFiles) {
    const content = await fs.readFile(file);
    const sha256 = await computeSha256(content);
    const metadata = await loadMetadata(file);
    files.push({
      ...metadata,
      name: metadata.name || relativeRulePath(file),
      sha256,
    });
  }
  files.sort((a, b) => a.name.localeCompare(b.name));
  const generatedAt = new Date().toISOString();
  return { files, generatedAt };
}

function manifestTemplate(ratesVersion: string, generatedAt: string, files: ManifestFileEntry[]) {
  return JSON.stringify(
    {
      rates_version: ratesVersion,
      generated_at: generatedAt,
      files: files.map(({ name, sha256, source_url, effective_from, effective_to, last_reviewed }) => ({
        name,
        sha256,
        source_url,
        effective_from,
        effective_to,
        last_reviewed,
      })),
    },
    null,
    2,
  );
}

function docsTemplate(generatedAt: string, files: ManifestFileEntry[]): string {
  const header = "# Current Tax Rules\n\n" + `Last generated at ${generatedAt}.\n\n`;
  const tableHeader = "| File | SHA256 | Source | Effective From | Effective To | Last Reviewed |\n" +
    "| --- | --- | --- | --- | --- | --- |\n";
  const rows = files
    .map((file) => {
      const sourceLink = file.source_url ? `[${file.source_url}](${file.source_url})` : "";
      const effectiveFrom = file.effective_from ?? "";
      const effectiveTo = file.effective_to ?? "";
      const lastReviewed = file.last_reviewed ?? "";
      return `| ${file.name} | ${file.sha256} | ${sourceLink} | ${effectiveFrom} | ${effectiveTo} | ${lastReviewed} |`;
    })
    .join("\n");
  return header + tableHeader + rows + "\n";
}

async function main() {
  const ratesVersion = "2024-25";
  const { files, generatedAt } = await buildManifest();
  await fs.writeFile(MANIFEST_PATH, manifestTemplate(ratesVersion, generatedAt, files));
  await fs.writeFile(DOC_PATH, docsTemplate(generatedAt, files));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
