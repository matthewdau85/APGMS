// scripts/sync_types.ts
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');

const source = path.join(repoRoot, 'src', 'types', 'templates', 'tax.ts');
const target = path.join(repoRoot, 'src', 'types', 'tax.ts');

const contents = fs.readFileSync(source, 'utf8');
fs.writeFileSync(target, contents.endsWith('\n') ? contents : `${contents}\n`);
