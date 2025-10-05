#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const files = [];

for (const arg of args) {
  if (arg === '--fix' || arg === '--no-fix') {
    continue;
  }
  if (arg.startsWith('-')) {
    continue;
  }
  files.push(arg);
}

if (files.length === 0) {
  process.exit(0);
}

let hasError = false;

const ruleMessage = "Use getPool() from src/db/pool.ts";

for (const file of files) {
  const filePath = path.resolve(process.cwd(), file);
  if (!fs.existsSync(filePath)) {
    continue;
  }
  if (filePath === __filename) {
    continue;
  }
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split(/\r?\n/);
  lines.forEach((line, index) => {
    if (line.includes('new Pool(')) {
      hasError = true;
      const location = `${file}:${index + 1}`;
      console.error(`${location}: error no-restricted-syntax ${ruleMessage}`);
    }
  });
}

if (hasError) {
  console.error('\nFound forbidden direct Pool construction. Please use getPool() from src/db/pool.ts.');
  process.exit(1);
}

process.exit(0);
