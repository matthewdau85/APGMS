import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const rulesDir = process.argv[2] ?? path.resolve("apps/services/tax-engine/app/rules");
const outputPath = path.join(rulesDir, "manifest.json");

function sha256Hex(data: string | Buffer) {
  return createHash("sha256").update(data).digest("hex");
}

async function loadRules() {
  const entries = await readdir(rulesDir, { withFileTypes: true });
  const files = entries.filter((e) => e.isFile() && e.name !== "manifest.json");
  const out: Array<{ name: string; sha256: string; version?: string }> = [];
  for (const file of files) {
    const fullPath = path.join(rulesDir, file.name);
    const data = await readFile(fullPath);
    const text = data.toString("utf8").replace(/^\uFEFF/, "");
    const sha = sha256Hex(text);
    let version: string | undefined;
    if (file.name.endsWith(".json")) {
      try {
        const parsed = JSON.parse(text);
        if (typeof parsed.version === "string") {
          version = parsed.version;
        }
      } catch {
        // ignore parse errors for version detection
      }
    }
    out.push({ name: file.name, sha256: sha, version });
  }
  return out;
}

async function main() {
  const files = await loadRules();
  const versions = new Set(files.map((f) => f.version).filter(Boolean) as string[]);
  const version = versions.size === 1 ? versions.values().next().value : "mixed";
  const manifestBase = {
    version,
    files: files.map(({ name, sha256 }) => ({ name, sha256 })).sort((a, b) => a.name.localeCompare(b.name)),
  };
  const manifest_sha256 = sha256Hex(JSON.stringify(manifestBase));
  const manifest = { ...manifestBase, manifest_sha256 };
  await writeFile(outputPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
  console.log(`Wrote manifest with ${files.length} files to ${outputPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
