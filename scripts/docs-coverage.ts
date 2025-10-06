import { readdir, stat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function collectMarkdown(dir: string, acc: string[] = []): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await collectMarkdown(fullPath, acc);
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      acc.push(fullPath);
    }
  }
  return acc;
}

async function main() {
  const docsDir = path.resolve(__dirname, '..', 'docs');
  try {
    await stat(docsDir);
  } catch {
    console.log('No docs directory present. Documentation coverage: 0/0 (100%).');
    return;
  }

  const files = await collectMarkdown(docsDir);
  if (!files.length) {
    console.log('No markdown documentation files found. Coverage 0/0 (100%).');
    return;
  }

  let documented = 0;
  for (const file of files) {
    const contents = await readFile(file, 'utf8');
    if (contents.trim().length > 0) {
      documented += 1;
    }
  }

  const coverage = (documented / files.length) * 100;
  const formatted = coverage.toFixed(2);
  console.log(`Documentation coverage: ${formatted}% (${documented}/${files.length})`);

  if (documented !== files.length) {
    console.error('Some documentation files are empty.');
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error('Failed to compute documentation coverage:', error);
  process.exitCode = 1;
});
