import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";

const RULES_ROOT = path.resolve("apps/services/tax-engine/app/rules");
const DIST_DIR = path.resolve("dist/rules");

async function walk(dir: string, acc: string[] = []): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(full, acc);
    } else {
      acc.push(full);
    }
  }
  return acc;
}

async function sha256(file: string) {
  const data = await fs.readFile(file);
  const hash = crypto.createHash("sha256");
  hash.update(data);
  return hash.digest("hex");
}

async function main() {
  const version = process.env.RATES_VERSION || "dev";
  const files = await walk(RULES_ROOT, []);
  const manifestFiles = await Promise.all(
    files
      .sort()
      .map(async (file) => ({
        name: path.relative(RULES_ROOT, file).replace(/\\/g, "/"),
        sha256: await sha256(file),
      }))
  );

  const manifestBody = {
    version,
    files: manifestFiles,
  };
  const manifestSha = crypto
    .createHash("sha256")
    .update(JSON.stringify(manifestBody))
    .digest("hex");

  const manifest = {
    ...manifestBody,
    manifest_sha256: manifestSha,
  };

  await fs.mkdir(DIST_DIR, { recursive: true });
  await fs.writeFile(path.join(DIST_DIR, "manifest.json"), JSON.stringify(manifest, null, 2));
  console.log(`rules manifest written for version ${version}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
