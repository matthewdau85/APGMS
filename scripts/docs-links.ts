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

function isRelativeLink(link: string) {
  return !/^(https?:)?\/\//.test(link) && !link.startsWith('#') && !link.startsWith('mailto:') && !link.startsWith('/');
}

async function main() {
  const docsDir = path.resolve(__dirname, '..', 'docs');
  try {
    await stat(docsDir);
  } catch {
    console.log('No docs directory present. Nothing to validate.');
    return;
  }

  const files = await collectMarkdown(docsDir);
  const missing: string[] = [];

  const linkRegex = /\[[^\]]+\]\(([^)]+)\)/g;
  for (const file of files) {
    const contents = await readFile(file, 'utf8');
    let match: RegExpExecArray | null;
    while ((match = linkRegex.exec(contents))) {
      const target = match[1].split('#')[0];
      if (!target || !isRelativeLink(target)) continue;
      const resolved = path.resolve(path.dirname(file), target);
      try {
        await stat(resolved);
      } catch {
        missing.push(`${file}: ${target}`);
      }
    }
  }

  if (missing.length) {
    console.error('Broken documentation links detected:');
    for (const m of missing) {
      console.error(` - ${m}`);
    }
    process.exitCode = 1;
  } else {
    console.log('All documentation links resolved successfully.');
  }
}

main().catch((error) => {
  console.error('Failed to validate documentation links:', error);
  process.exitCode = 1;
});
