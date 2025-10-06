import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

interface GlossRange {
  term: string;
  start: number;
  end: number;
}

interface Violation {
  file: string;
  line: number;
  term: string;
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const JARGON_PATH = path.join(ROOT, 'content', 'jargon.json');
const GLOSSARY_PATH = path.join(ROOT, 'content', 'glossary.json');

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw) as T;
  } catch (error: any) {
    if (error && error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

async function collectSourceFiles(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) {
        continue;
      }
      files.push(...(await collectSourceFiles(entryPath)));
    } else if (/\.(ts|tsx|mdx)$/i.test(entry.name)) {
      files.push(entryPath);
    }
  }

  return files;
}

function findGlossRanges(content: string): GlossRange[] {
  const ranges: GlossRange[] = [];
  const openRegex = /<Gloss[^>]*term\s*=\s*["'`](.*?)["'`][^>]*>/gis;
  let openMatch: RegExpExecArray | null;

  while ((openMatch = openRegex.exec(content)) !== null) {
    const term = openMatch[1];
    const closeRegex = /<\/Gloss>/gis;
    closeRegex.lastIndex = openRegex.lastIndex;
    const closeMatch = closeRegex.exec(content);
    const end = closeMatch ? closeMatch.index + closeMatch[0].length : content.length;
    ranges.push({ term, start: openMatch.index, end });
    if (!closeMatch) {
      break;
    }
    openRegex.lastIndex = end;
  }

  return ranges;
}

function buildLineStartIndices(content: string): number[] {
  const indices: number[] = [0];
  for (let i = 0; i < content.length; i += 1) {
    if (content[i] === '\n') {
      indices.push(i + 1);
    }
  }
  return indices;
}

function getLineNumber(position: number, lineStarts: number[]): number {
  let low = 0;
  let high = lineStarts.length - 1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const start = lineStarts[mid];
    const nextStart = mid + 1 < lineStarts.length ? lineStarts[mid + 1] : Number.POSITIVE_INFINITY;

    if (position < start) {
      high = mid - 1;
    } else if (position >= nextStart) {
      low = mid + 1;
    } else {
      return mid + 1;
    }
  }

  return lineStarts.length;
}

function isInsideGlossRange(ranges: GlossRange[], term: string, position: number): boolean {
  return ranges.some((range) => range.term === term && position >= range.start && position < range.end);
}

async function main(): Promise<void> {
  const jargonTerms = await readJsonFile<string[]>(JARGON_PATH);
  if (!jargonTerms || !Array.isArray(jargonTerms)) {
    console.error('Unable to load jargon list from content/jargon.json.');
    process.exitCode = 1;
    return;
  }

  const glossary = await readJsonFile<Record<string, unknown>>(GLOSSARY_PATH);
  if (glossary) {
    const glossaryKeys = Object.keys(glossary);
    const missingInGlossary = jargonTerms.filter((term) => !glossaryKeys.includes(term));
    const missingInJargon = glossaryKeys.filter((key) => !jargonTerms.includes(key));
    if (missingInGlossary.length || missingInJargon.length) {
      console.error('Glossary mismatch detected. Ensure content/jargon.json matches content/glossary.json keys.');
      if (missingInGlossary.length) {
        console.error(`  Missing in glossary.json: ${missingInGlossary.join(', ')}`);
      }
      if (missingInJargon.length) {
        console.error(`  Missing in jargon.json: ${missingInJargon.join(', ')}`);
      }
      process.exitCode = 1;
      return;
    }
  }

  const sourceDir = path.join(ROOT, 'src');
  let sourceFiles: string[] = [];
  try {
    sourceFiles = await collectSourceFiles(sourceDir);
  } catch (error: any) {
    if (error && error.code === 'ENOENT') {
      console.error('Source directory not found: src');
      process.exitCode = 1;
      return;
    }
    throw error;
  }

  const violations: Violation[] = [];

  for (const filePath of sourceFiles) {
    const content = await fs.readFile(filePath, 'utf8');
    if (!content) {
      continue;
    }

    const relativePath = path.relative(ROOT, filePath).split(path.sep).join('/');
    const normalizedPath = relativePath;
    const isHelpDoc = normalizedPath.includes('/help/');
    const helpExplained = new Set<string>();
    const glossRanges = findGlossRanges(content);
    const lineStarts = buildLineStartIndices(content);
    const lines = content.split(/\r?\n/);

    for (const term of jargonTerms) {
      const termRegex = new RegExp(`\\b${escapeRegExp(term)}\\b`, 'g');
      let match: RegExpExecArray | null;
      while ((match = termRegex.exec(content)) !== null) {
        const index = match.index;
        if (isInsideGlossRange(glossRanges, term, index)) {
          continue;
        }

        const lineNumber = getLineNumber(index, lineStarts);
        const lineStart = lineStarts[lineNumber - 1] ?? 0;
        const lineText = lines[lineNumber - 1] ?? '';
        const columnInLine = index - lineStart;
        const remainder = lineText.slice(columnInLine + term.length);

        if (isHelpDoc) {
          if (helpExplained.has(term)) {
            continue;
          }
          if (/^\s*\([^)]*\)/.test(remainder)) {
            helpExplained.add(term);
            continue;
          }
        }

        violations.push({ file: normalizedPath, line: lineNumber, term });
      }
    }
  }

  if (violations.length > 0) {
    console.error('Jargon check failed. Wrap flagged terms in <Gloss> or provide a plain-language explanation.');
    violations
      .sort((a, b) => (a.file === b.file ? a.line - b.line : a.file.localeCompare(b.file)))
      .forEach((violation) => {
        console.error(`${violation.file}:${violation.line} - ${violation.term}`);
      });
    process.exitCode = 1;
    return;
  }
}

main().catch((error) => {
  console.error('Unexpected error while running jargon check.');
  console.error(error);
  process.exitCode = 1;
});
