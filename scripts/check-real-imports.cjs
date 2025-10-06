#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC_ROOT = path.join(ROOT, 'apps', 'services', 'payments', 'src');
const IGNORE_DIRS = new Set([
  path.join(SRC_ROOT, 'providers'),
  path.join(SRC_ROOT, 'core', 'providers'),
  path.join(SRC_ROOT, 'core', 'ports')
]);

const bannedPattern = /from\s+['"]@providers\/[^'"`]*\/real['"]/g;
const errors = [];

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if ([...IGNORE_DIRS].some((ignored) => fullPath.startsWith(ignored))) {
        continue;
      }
      walk(fullPath);
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      const content = fs.readFileSync(fullPath, 'utf8');
      if (bannedPattern.test(content)) {
        errors.push(fullPath.replace(ROOT + path.sep, ''));
      }
    }
  }
}

if (fs.existsSync(SRC_ROOT)) {
  walk(SRC_ROOT);
}

if (errors.length) {
  console.error('Forbidden imports detected (business modules must use ports):');
  for (const file of errors) {
    console.error(' -', file);
  }
  process.exit(1);
}
