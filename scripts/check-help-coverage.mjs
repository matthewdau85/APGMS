import fs from 'fs';
import path from 'path';

const root = path.resolve(new URL('.', import.meta.url).pathname, '..');
const appFile = path.join(root, 'src', 'App.tsx');
const pagesDir = path.join(root, 'src', 'pages');
const docsDir = path.join(root, 'docs');

function readFile(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

const appSource = readFile(appFile);
const routeRegex = /<Route\s+path="([^"]+)"\s+element={<([A-Za-z0-9_]+)\s*\/>}/g;
const routes = [];
let match;
while ((match = routeRegex.exec(appSource)) !== null) {
  routes.push({ path: match[1], component: match[2] });
}

const errors = [];
const seenSlugs = new Set();

routes.forEach(({ path: routePath, component }) => {
  const pageFile = path.join(pagesDir, `${component}.tsx`);
  if (!fs.existsSync(pageFile)) {
    errors.push(`Route ${routePath} points to missing page file ${pageFile}`);
    return;
  }
  const source = readFile(pageFile);
  const metaMatch = source.match(/export const meta:[^=]*=\s*({[\s\S]*?});/);
  if (!metaMatch) {
    errors.push(`Page ${component} is missing an exported meta constant.`);
    return;
  }
  const metaBlock = metaMatch[1];
  const helpMatch = metaBlock.match(/helpSlug:\s*['"]([^'"\n]+)['"]/);
  if (!helpMatch) {
    errors.push(`Page ${component} meta does not include helpSlug.`);
    return;
  }
  const slug = helpMatch[1];
  seenSlugs.add(slug);
  const docPath = path.join(docsDir, `${slug}.mdx`);
  if (!fs.existsSync(docPath)) {
    errors.push(`Help slug "${slug}" for page ${component} does not have a docs/${slug}.mdx file.`);
  }
});

if (routes.length === 0) {
  errors.push('No routes discovered in src/App.tsx');
}

if (errors.length > 0) {
  console.error('Help coverage check failed:\n' + errors.map((err) => ` - ${err}`).join('\n'));
  process.exit(1);
}

console.log(`Help coverage check passed for ${routes.length} routes. Slugs covered: ${Array.from(seenSlugs).join(', ')}.`);
