#!/usr/bin/env tsx
import type { CodexManifestEntry } from '../src/utils/codexFeed';
import { loadFiles } from '../src/utils/codexFeed';

async function main() {
  const [, , ...args] = process.argv;
  const [needle] = args;

  let filter: ((entry: CodexManifestEntry) => boolean) | undefined;

  if (needle) {
    console.error(`Filtering manifest entries containing: ${needle}`);
    const lowerNeedle = needle.toLowerCase();
    filter = (entry) => entry.file_relative.toLowerCase().includes(lowerNeedle);
  }

  const files = await loadFiles({ filter });

  console.log(`Loaded ${files.length} file(s) from the Codex feed${needle ? ` matching "${needle}"` : ''}.`);

  for (const file of files) {
    console.log(`\n# ${file.fileRelative}`);
    console.log(`Language: ${file.language ?? 'n/a'} | Parts: ${file.parts} | Characters: ${file.chars}`);
    console.log('---');
    console.log(file.text.trim());
  }
}

main().catch((error) => {
  console.error('Failed to read Codex feed:', error);
  process.exitCode = 1;
});
