#!/usr/bin/env ts-node
/**
 * Checks that glossary acronyms are introduced as "plain term (ACRONYM)" the first
 * time they appear in an MDX page and that the content is wrapped in a <Gloss> tag.
 *
 * The checker walks the repository (skipping heavy or third-party directories), inspects
 * every `.mdx` file and analyses the <Gloss> components it finds. For each acronym it
 * remembers the first <Gloss> occurrence and ensures that:
 *   • the rendered text contains parentheses;
 *   • the parentheses contain the acronym; and
 *   • the text before the parentheses is not the acronym (i.e. it is the plain term).
 *
 * Subsequent <Gloss> occurrences can contain the acronym by itself. When a violation is
 * detected the script reports the file path and the line that failed and exits with a
 * non-zero status so CI can flag the issue.
 */

import fs from "node:fs";
import path from "node:path";

interface GlossOccurrence {
  file: string;
  acronym: string;
  cleanText: string;
  line: number;
  column: number;
  rawInner: string;
}

const RE_GLOSS = /<Gloss\b([^>]*)>([\s\S]*?)<\/Gloss>/g;
const ATTR_VALUE = /(?:=\s*)(?:\{\s*["']([^"']+)["']\s*\}|["']([^"']+)["']|\{([^{}]+)\})/i;
const ATTR_KEY = /\b(?:term|entry|acronym|id|slug|for|value|name)\s*=\s*(?:\{\s*["'][^"']+["']\s*\}|["'][^"']+["']|\{[^{}]+\})/gi;

const SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  ".pnpm",
  "__pycache__",
  ".turbo",
  "dist",
  "build",
  "out",
  "docs/_codex_feed",
  "scripts/node_modules",
]);

const SEARCH_ROOTS = ["docs", "pages", "src", "apps"];

function main(): void {
  const repoRoot = process.cwd();
  const files = collectMdxFiles(repoRoot);

  const errors: string[] = [];

  for (const file of files) {
    const content = fs.readFileSync(file, "utf8");
    const occurrences = extractGlossOccurrences(content, file);
    if (occurrences.length === 0) {
      continue;
    }

    const seen = new Map<string, GlossOccurrence>();

    for (const occurrence of occurrences) {
      const key = occurrence.acronym.toUpperCase();
      if (!seen.has(key)) {
        const error = validateFirstOccurrence(occurrence);
        if (error) {
          errors.push(error);
        }
        seen.set(key, occurrence);
      }
    }
  }

  if (errors.length > 0) {
    console.error("Glossary introduction issues detected:\n");
    for (const err of errors) {
      console.error(` • ${err}`);
    }
    process.exitCode = 1;
    return;
  }

  process.exitCode = 0;
}

function collectMdxFiles(repoRoot: string): string[] {
  const results: string[] = [];

  const queue = SEARCH_ROOTS
    .map((relative) => path.join(repoRoot, relative))
    .filter((candidate) => fs.existsSync(candidate));

  while (queue.length > 0) {
    const current = queue.pop()!;
    const stats = safeStat(current);
    if (!stats) {
      continue;
    }

    if (stats.isDirectory()) {
      const rel = path.relative(repoRoot, current);
      if (shouldSkipDirectory(rel)) {
        continue;
      }
      for (const entry of fs.readdirSync(current)) {
        queue.push(path.join(current, entry));
      }
    } else if (stats.isFile() && current.endsWith(".mdx")) {
      results.push(current);
    }
  }

  return results.sort();
}

function shouldSkipDirectory(relativePath: string): boolean {
  const normalized = relativePath.split(path.sep).join("/");
  const segments = normalized.split("/");
  for (const skip of SKIP_DIRS) {
    if (skip.includes("/")) {
      if (normalized === skip || normalized.startsWith(`${skip}/`)) {
        return true;
      }
      continue;
    }

    if (segments.includes(skip)) {
      return true;
    }
  }
  return false;
}

function safeStat(target: string): fs.Stats | undefined {
  try {
    return fs.statSync(target);
  } catch {
    return undefined;
  }
}

function extractGlossOccurrences(content: string, file: string): GlossOccurrence[] {
  const occurrences: GlossOccurrence[] = [];
  let match: RegExpExecArray | null;

  while ((match = RE_GLOSS.exec(content)) !== null) {
    const [, rawAttr = "", inner = ""] = match;
    const cleanText = stripMarkup(inner);
    if (!cleanText) {
      continue;
    }

    const acronym = determineAcronym(rawAttr, cleanText);
    if (!acronym) {
      continue;
    }

    const position = indexToLineColumn(content, match.index ?? 0);

    occurrences.push({
      file,
      acronym,
      cleanText,
      line: position.line,
      column: position.column,
      rawInner: inner,
    });
  }

  return occurrences;
}

function determineAcronym(rawAttr: string, cleanText: string): string | undefined {
  const attrRegex = new RegExp(ATTR_KEY);
  let attrMatch: RegExpExecArray | null;

  while ((attrMatch = attrRegex.exec(rawAttr)) !== null) {
    const rawValueMatch = ATTR_VALUE.exec(attrMatch[0]);
    if (!rawValueMatch) {
      continue;
    }
    const rawValue = (rawValueMatch[1] ?? rawValueMatch[2] ?? rawValueMatch[3] ?? "").trim();
    if (!rawValue) {
      continue;
    }

    if (!/^[A-Za-z0-9/+&-\s]+$/.test(rawValue)) {
      continue;
    }

    const normalized = normaliseAcronym(rawValue);
    if (normalized) {
      return normalized;
    }
  }

  const parenMatch = findParenthesisedAcronym(cleanText);
  if (parenMatch) {
    return normaliseAcronym(parenMatch);
  }

  const fallback = findUppercaseToken(cleanText);
  return fallback ? normaliseAcronym(fallback) : undefined;
}

function normaliseAcronym(value: string): string {
  return value.replace(/[^A-Za-z0-9/+&-]/g, "").toUpperCase();
}

function findParenthesisedAcronym(text: string): string | undefined {
  const regex = /\(([^()]+)\)/g;
  let match: RegExpExecArray | null;
  let last: string | undefined;

  while ((match = regex.exec(text)) !== null) {
    const candidate = match[1].trim();
    if (candidate) {
      last = candidate;
    }
  }

  return last;
}

function findUppercaseToken(text: string): string | undefined {
  const tokens = text.split(/[^A-Za-z0-9/+&-]+/);
  for (const token of tokens) {
    if (!token) {
      continue;
    }
    if (token === token.toUpperCase() && /[A-Z]/.test(token)) {
      return token;
    }
  }
  return undefined;
}

function stripMarkup(value: string): string {
  return value
    .replace(/<!--([\s\S]*?)-->/g, " ")
    .replace(/\{[\s\S]*?\}/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/[`*_]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function indexToLineColumn(text: string, index: number): { line: number; column: number } {
  const slice = text.slice(0, index);
  const lines = slice.split(/\n/);
  const line = lines.length;
  const column = lines[lines.length - 1]?.length ?? 0;
  return { line, column };
}

function validateFirstOccurrence(occurrence: GlossOccurrence): string | undefined {
  const { acronym, cleanText } = occurrence;
  const trimmed = cleanText.trim();
  const openIndex = trimmed.indexOf("(");
  const closeIndex = trimmed.indexOf(")", openIndex + 1);

  if (openIndex === -1 || closeIndex === -1) {
    return formatError(
      occurrence,
      `first <Gloss> for ${acronym} must introduce the plain term before the acronym (e.g. "Plain (${acronym})"), but found "${cleanText}"`
    );
  }

  const before = trimmed.slice(0, openIndex).trim();
  const inside = trimmed.slice(openIndex + 1, closeIndex).trim();

  if (!before) {
    return formatError(
      occurrence,
      `first <Gloss> for ${acronym} is missing the plain term before the acronym`
    );
  }

  if (normaliseAcronym(before) === acronym) {
    return formatError(
      occurrence,
      `first <Gloss> for ${acronym} uses the acronym before the parentheses; expected "${expandExample(acronym)}"`
    );
  }

  if (normaliseAcronym(inside) !== acronym) {
    return formatError(
      occurrence,
      `first <Gloss> for ${acronym} must include "${acronym}" inside parentheses; found "${inside}"`
    );
  }

  return undefined;
}

function expandExample(acronym: string): string {
  return `Plain term (${acronym})`;
}

function formatError(occurrence: GlossOccurrence, message: string): string {
  const relative = path.relative(process.cwd(), occurrence.file);
  return `${relative}:${occurrence.line}: ${message}`;
}

main();
