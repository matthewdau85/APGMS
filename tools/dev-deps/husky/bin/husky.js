#!/usr/bin/env node
const { execSync } = require('child_process');

const args = process.argv.slice(2);
if (args[0] === 'install') {
  try {
    execSync('git config core.hooksPath .husky', { stdio: 'inherit' });
  } catch (error) {
    console.error('husky: failed to configure git hooks path');
    process.exit(1);
  }
  process.exit(0);
}

console.error('husky: unsupported command. Use "husky install" to configure hooks.');
process.exit(1);
