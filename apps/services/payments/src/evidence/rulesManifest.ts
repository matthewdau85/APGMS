import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

export type ManifestFile = {
  path: string;
  sha256: string;
  bytes: number;
};

export type RulesManifest = {
  version: string;
  generated_at: string;
  files: ManifestFile[];
  manifest_sha256: string;
};

async function listFiles(root: string): Promise<string[]> {
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  const out: string[] = [];
  for (const entry of entries) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      const nested = await listFiles(full);
      nested.forEach(p => out.push(path.join(entry.name, p)));
    } else if (entry.isFile()) {
      out.push(entry.name);
    }
  }
  return out.sort();
}

async function hashFile(fullPath: string): Promise<{ sha: string; bytes: number }> {
  const buf = await fs.readFile(fullPath);
  const sha = createHash("sha256").update(buf).digest("hex");
  return { sha, bytes: buf.byteLength };
}

export async function computeRulesManifest(dir: string, version?: string): Promise<RulesManifest> {
  const absolute = path.resolve(dir);
  const files = await listFiles(absolute);
  const manifestFiles: ManifestFile[] = [];
  for (const rel of files) {
    const full = path.join(absolute, rel);
    const { sha, bytes } = await hashFile(full);
    manifestFiles.push({ path: rel, sha256: sha, bytes });
  }

  const manifestBase = {
    version: version || process.env.RULES_VERSION || "v1",
    generated_at: new Date().toISOString(),
    files: manifestFiles,
  };
  const digestTarget = {
    version: manifestBase.version,
    files: manifestFiles,
  };
  const digest = createHash("sha256").update(JSON.stringify(digestTarget)).digest("hex");
  return { ...manifestBase, manifest_sha256: digest };
}

