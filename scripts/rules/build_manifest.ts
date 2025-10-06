import { promises as fs } from "fs";
import path from "path";
import { createHash } from "crypto";

type FileEntry = { name: string; sha256: string };

async function exists(p: string) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function walk(dir: string, prefix = ""): Promise<FileEntry[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files: FileEntry[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walk(full, rel));
    } else if (entry.isFile()) {
      const content = await fs.readFile(full);
      const sha256 = createHash("sha256").update(content).digest("hex");
      files.push({ name: rel, sha256 });
    }
  }
  return files;
}

async function resolveRulesDir(): Promise<string> {
  const candidates = [
    path.resolve(process.cwd(), "tax-engine/app/rules"),
    path.resolve(process.cwd(), "apps/services/tax-engine/app/rules"),
  ];
  for (const candidate of candidates) {
    if (await exists(candidate)) return candidate;
  }
  throw new Error("Unable to locate tax-engine rules directory");
}

async function main() {
  const rulesDir = await resolveRulesDir();
  const files = await walk(rulesDir);
  files.sort((a, b) => a.name.localeCompare(b.name));

  const version = process.env.RATES_VERSION || "dev";
  const manifestWithoutHash = { version, files };
  const manifestString = JSON.stringify(manifestWithoutHash);
  const manifest_sha256 = createHash("sha256").update(manifestString).digest("hex");
  const manifest = { ...manifestWithoutHash, manifest_sha256 };

  const outPath = path.resolve(process.cwd(), "scripts/rules/manifest.json");
  await fs.writeFile(outPath, JSON.stringify(manifest, null, 2));
  console.log(`wrote manifest with ${files.length} file(s) -> ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
