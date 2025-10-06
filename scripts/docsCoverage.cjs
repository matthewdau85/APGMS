#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const specPath = path.resolve(__dirname, '..', 'portal-api', 'openapi.json');
if (!fs.existsSync(specPath)) {
  console.error(`OpenAPI spec missing at ${specPath}`);
  process.exit(1);
}

const helpDir = path.resolve(__dirname, '..', 'apps', 'gui', 'help');
if (!fs.existsSync(helpDir)) {
  console.error(`Help directory missing at ${helpDir}`);
  process.exit(1);
}

const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
const helpFiles = fs
  .readdirSync(helpDir)
  .filter((file) => file.endsWith('.md'))
  .map((file) => path.join(helpDir, file));

const helpContent = helpFiles.map((file) => ({
  file,
  content: fs.readFileSync(file, 'utf8')
}));

const missing = [];

const methodNames = new Set(['get', 'post', 'put', 'patch', 'delete', 'options', 'head']);

for (const [route, operations] of Object.entries(spec.paths || {})) {
  const routeIsInternal = operations['x-internal'] === true;
  for (const [method, op] of Object.entries(operations)) {
    if (!methodNames.has(method)) continue;
    const opIsInternal = op['x-internal'] === true || routeIsInternal;
    if (opIsInternal) continue;
    const needle = `${method.toUpperCase()} ${route}`;
    const documented = helpContent.some(({ content }) => content.includes(route));
    if (!documented) {
      missing.push(needle);
    }
  }
}

if (missing.length > 0) {
  console.error('Missing help coverage for endpoints:');
  for (const item of missing) {
    console.error(` - ${item}`);
  }
  process.exit(1);
}

console.log(`docs:coverage ✓ (${helpFiles.length} help pages cover ${Object.keys(spec.paths || {}).length} routes)`);
