#!/usr/bin/env node
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const projectRoot = findProjectRoot();
if (!projectRoot) {
  console.error('lint-staged: unable to locate package.json');
  process.exit(1);
}

const pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
const config = pkg['lint-staged'] || {};

if (Object.keys(config).length === 0) {
  process.exit(0);
}

let stagedFiles = execSync('git diff --staged --name-only', { encoding: 'utf8' })
  .split(/\r?\n/)
  .filter(Boolean);

if (stagedFiles.length === 0) {
  process.exit(0);
}

let success = true;

for (const [pattern, command] of Object.entries(config)) {
  const matcher = globToRegExp(pattern);
  const matched = stagedFiles.filter((file) => {
    if (matcher.test(file)) {
      return true;
    }
    if (!pattern.includes('/')) {
      return matcher.test(path.basename(file));
    }
    return false;
  });
  if (matched.length === 0) {
    continue;
  }

  const quoted = matched.map((file) => `"${file.replace(/"/g, '\\"')}"`).join(' ');
  const binPath = path.join(projectRoot, 'node_modules', '.bin');
  const env = { ...process.env };
  env.PATH = `${binPath}${path.delimiter}${env.PATH || ''}`;

  try {
    execSync(`${command} ${quoted}`.trim(), {
      cwd: projectRoot,
      stdio: 'inherit',
      env
    });
  } catch (error) {
    success = false;
  }
}

process.exit(success ? 0 : 1);

function globToRegExp(glob) {
  let pattern = glob.replace(/[-\\^$+?.()|[\]]/g, '\\$&');
  pattern = pattern.replace(/\{([^}]+)\}/g, (_, inner) => {
    const options = inner.split(',').map((part) => part.trim());
    return `(${options.join('|')})`;
  });
  pattern = pattern
    .replace(/\*\*/g, '.*')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '.');
  return new RegExp(`^${pattern}$`);
}

function findProjectRoot() {
  let current = process.cwd();
  while (current && current !== path.parse(current).root) {
    if (fs.existsSync(path.join(current, 'package.json'))) {
      return current;
    }
    current = path.dirname(current);
  }
  return null;
}
