// scripts/sync_openapi.ts
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

function sortObject<T extends Record<string, any>>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => sortObject(item)) as unknown as T;
  }
  if (value && typeof value === 'object') {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      sorted[key] = sortObject(value[key]);
    }
    return sorted as T;
  }
  return value;
}

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const sourcePath = path.join(repoRoot, 'schema', 'openapi.source.json');
const targetPath = path.join(repoRoot, 'schema', 'openapi.json');

const raw = fs.readFileSync(sourcePath, 'utf8');
const data = JSON.parse(raw);
const sorted = sortObject(data);
const payload = JSON.stringify(sorted, null, 2) + '\n';
fs.writeFileSync(targetPath, payload);
