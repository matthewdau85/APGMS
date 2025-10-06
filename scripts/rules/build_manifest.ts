import crypto from "crypto";
import { readFile, readdir, writeFile } from "fs/promises";
import path from "path";
import { pathToFileURL } from "url";

const RULES_DIR = path.resolve(process.cwd(), "apps/services/tax-engine/app/rules");
const MANIFEST_PATH = path.join(RULES_DIR, "manifest.json");
const PYPROJECT_PATH = path.resolve(process.cwd(), "apps/services/tax-engine/pyproject.toml");

async function readVersion(): Promise<string> {
  try {
    const text = await readFile(PYPROJECT_PATH, "utf8");
    const match = text.match(/^version\s*=\s*"([^"]+)"/m);
    if (match) {
      return match[1];
    }
  } catch (error) {
    // fall through to default version
  }
  return "0.0.0";
}

async function listRuleFiles(dir: string, baseDir = dir): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const childFiles = await listRuleFiles(entryPath, baseDir);
      files.push(...childFiles);
    } else if (entry.isFile()) {
      const rel = path.relative(baseDir, entryPath).replace(/\\/g, "/");
      if (rel === "manifest.json") {
        continue;
      }
      files.push(rel);
    }
  }
  return files;
}

async function hashFile(filePath: string): Promise<string> {
  const data = await readFile(filePath);
  return crypto.createHash("sha256").update(data).digest("hex");
}

async function main() {
  const version = await readVersion();
  const relativeFiles = await listRuleFiles(RULES_DIR);
  relativeFiles.sort();
  const files = await Promise.all(
    relativeFiles.map(async (name) => ({
      name,
      sha256: await hashFile(path.join(RULES_DIR, name)),
    })),
  );

  const baseManifest = { version, files };
  const manifestSha256 = crypto
    .createHash("sha256")
    .update(JSON.stringify(baseManifest))
    .digest("hex");

  const manifest = { ...baseManifest, manifest_sha256: manifestSha256 };
  await writeFile(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  console.log(
    `Wrote ${files.length} rule${files.length === 1 ? "" : "s"} to ${path.relative(process.cwd(), MANIFEST_PATH)}`,
  );
  console.log(`manifest_sha256=${manifestSha256}`);
}

const entryPoint = process.argv[1];
if (entryPoint && import.meta.url === pathToFileURL(entryPoint).href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
