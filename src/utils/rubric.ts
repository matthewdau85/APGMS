import { createHash } from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

export interface RubricManifest<T = any> {
  version: number;
  path: string;
  data: T;
  manifestSha256: string;
}

let cached: RubricManifest | null = null;

export function loadRubricManifestSync<T = any>(): RubricManifest<T> {
  if (cached) {
    return cached as RubricManifest<T>;
  }
  const here = path.dirname(fileURLToPath(import.meta.url));
  const root = path.resolve(here, "..", "..");
  const readinessDir = path.join(root, "docs", "readiness");
  const entries = fs.readdirSync(readinessDir).filter((f) => /^rubric\.v\d+\.json$/i.test(f));
  if (entries.length === 0) {
    throw new Error("No rubric manifest found under docs/readiness");
  }
  entries.sort((a, b) => {
    const av = Number(a.match(/\d+/)?.[0] || 0);
    const bv = Number(b.match(/\d+/)?.[0] || 0);
    return av - bv;
  });
  const latest = entries[entries.length - 1];
  const fullPath = path.join(readinessDir, latest);
  const text = fs.readFileSync(fullPath, "utf8");
  const data = JSON.parse(text);
  const version = Number(data.version ?? latest.match(/\d+/)?.[0] ?? 0);
  const manifestSha256 = createHash("sha256").update(text).digest("hex");
  cached = { version, path: fullPath, data, manifestSha256 };
  return cached as RubricManifest<T>;
}

export function invalidateRubricCache() {
  cached = null;
}
