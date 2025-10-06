import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve, dirname } from "node:path";

import { buildOpenApiSpec } from "./openapi";

const HTTP_METHODS = new Set(["get", "post", "put", "patch", "delete", "options", "head", "trace"]);

interface DocRecord {
  filePath: string;
  slug: string;
  title: string;
  summary: string;
  headings: string[];
  body: string;
  plainText: string;
  links: string[];
}

function walkDocs(dir: string): string[] {
  const entries = readdirSync(dir);
  const results: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) {
      results.push(...walkDocs(full));
    } else if (stats.isFile() && entry.endsWith(".mdx")) {
      results.push(full);
    }
  }
  return results;
}

function parseFrontmatter(raw: string): { data: Record<string, string>; body: string } {
  const frontmatterMatch = raw.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!frontmatterMatch) {
    return { data: {}, body: raw.trim() };
  }
  const frontmatter = frontmatterMatch[1];
  const body = raw.slice(frontmatterMatch[0].length).trim();
  const data: Record<string, string> = {};
  for (const line of frontmatter.split(/\n+/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const [key, ...rest] = trimmed.split(":");
    if (!key || rest.length === 0) continue;
    const value = rest.join(":").trim().replace(/^"|"$/g, "");
    data[key.trim()] = value;
  }
  return { data, body };
}

function summarise(body: string): string {
  const paragraphs = body
    .split(/\n{2,}/)
    .map((chunk) => chunk.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  return paragraphs[0] ?? "";
}

function stripMarkdown(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[(.*?)\]\((.*?)\)/g, "$1")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/^>\s?/gm, "")
    .replace(/[*_~]/g, "")
    .replace(/\r/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractLinks(markdown: string): string[] {
  const links: string[] = [];
  const regex = /\[(?:[^\]]+)\]\(([^)]+)\)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(markdown))) {
    links.push(match[1]);
  }
  return links;
}

function loadDocs(): DocRecord[] {
  const docsDir = resolve(process.cwd(), "docs");
  if (!existsSync(docsDir)) {
    throw new Error("docs directory not found");
  }
  const files = walkDocs(docsDir);
  return files.map((filePath) => {
    const raw = readFileSync(filePath, "utf8");
    const { data, body } = parseFrontmatter(raw);
    const title = data.title || body.split("\n")[0]?.replace(/^#+\s*/, "").trim() || relative(docsDir, filePath);
    const slug = data.slug || title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
    const summary = data.summary || summarise(body);
    const headings = body
      .split("\n")
      .filter((line) => line.trim().startsWith("#"))
      .map((line) => line.replace(/^#+\s*/, "").trim());
    const plainText = stripMarkdown(body);
    const links = extractLinks(body);
    return { filePath, slug, title, summary, headings, body, plainText, links };
  });
}

interface Endpoint {
  method: string;
  path: string;
}

function listPublicEndpoints(): Endpoint[] {
  const spec = buildOpenApiSpec();
  const endpoints: Endpoint[] = [];
  for (const [pathKey, item] of Object.entries(spec.paths ?? {})) {
    if (!item) continue;
    for (const [method, operation] of Object.entries(item)) {
      if (!HTTP_METHODS.has(method)) continue;
      if (!operation || typeof operation !== "object") continue;
      const op: any = operation;
      if (op["x-public"] === false) continue;
      endpoints.push({ method: method.toUpperCase(), path: pathKey });
    }
  }
  return endpoints;
}

function ensureCoverage(docs: DocRecord[], endpoints: Endpoint[]): string[] {
  const problems: string[] = [];
  const lowerDocs = docs.map((doc) => ({ ...doc, lower: doc.body.toLowerCase() }));
  for (const endpoint of endpoints) {
    const needle = `${endpoint.method} ${endpoint.path}`.toLowerCase();
    const found = lowerDocs.some((doc) => doc.lower.includes(needle));
    if (!found) {
      problems.push(`Missing documentation for ${endpoint.method} ${endpoint.path}`);
    }
  }
  return problems;
}

function ensureLinks(docs: DocRecord[]): string[] {
  const problems: string[] = [];
  for (const doc of docs) {
    for (const link of doc.links) {
      const clean = link.split("#")[0].split("?")[0];
      if (!clean || /^(https?:|mailto:|tel:)/i.test(clean)) continue;
      if (clean.startsWith("#")) continue;
      let target: string;
      if (clean.startsWith("/")) {
        target = resolve(process.cwd(), clean.slice(1));
      } else {
        target = resolve(dirname(doc.filePath), clean);
      }
      if (!existsSync(target)) {
        problems.push(`Dead link in ${relative(process.cwd(), doc.filePath)} -> ${link}`);
      }
    }
  }
  return problems;
}

function buildSearchIndex(docs: DocRecord[]) {
  const records = docs
    .map((doc) => ({
      slug: doc.slug,
      title: doc.title,
      summary: doc.summary,
      headings: doc.headings,
      body: doc.body,
      plainText: doc.plainText
    }))
    .sort((a, b) => a.title.localeCompare(b.title));
  const publicDir = resolve(process.cwd(), "apps/web/console/public");
  mkdirSync(publicDir, { recursive: true });
  const outputPath = join(publicDir, "help-index.json");
  writeFileSync(outputPath, JSON.stringify({ generatedAt: new Date().toISOString(), docs: records }, null, 2) + "\n");
  console.log(`Help index written to ${relative(process.cwd(), outputPath)}`);
}

function main() {
  const docs = loadDocs();
  const endpoints = listPublicEndpoints();
  const coverageIssues = ensureCoverage(docs, endpoints);
  const linkIssues = ensureLinks(docs);

  if (coverageIssues.length || linkIssues.length) {
    [...coverageIssues, ...linkIssues].forEach((msg) => console.error(msg));
    process.exit(1);
  }

  buildSearchIndex(docs);
  console.log(`Documented ${endpoints.length} public endpoints across ${docs.length} pages.`);
}

main();
