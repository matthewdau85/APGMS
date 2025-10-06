import { promises as fs } from "fs";
import path from "path";
import { parseFrontmatter } from "./frontmatter";

const HELP_ROOT = path.resolve(process.cwd(), "docs/help");

async function findMdxFiles(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await findMdxFiles(full)));
    } else if (entry.isFile() && entry.name.endsWith(".mdx")) {
      files.push(full);
    }
  }
  return files;
}

function extractLinks(markdown: string): { href: string; index: number }[] {
  const matches: { href: string; index: number }[] = [];
  const regex = /\[[^\]]+\]\(([^)]+)\)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(markdown)) !== null) {
    matches.push({ href: match[1], index: match.index });
  }
  return matches;
}

function validateLink(href: string): string | null {
  if (!href) {
    return "missing href";
  }
  if (href.startsWith("http://") || href.startsWith("https://")) {
    try {
      new URL(href);
      return null;
    } catch (err) {
      return "invalid URL";
    }
  }
  if (href.startsWith("mailto:")) {
    return null;
  }
  if (href.startsWith("#")) {
    return null;
  }
  if (href.startsWith("/")) {
    if (href.includes(" ")) {
      return "contains spaces";
    }
    return null;
  }
  if (href.includes(" ")) {
    return "contains spaces";
  }
  return null;
}

async function main() {
  try {
    await fs.access(HELP_ROOT);
  } catch (err) {
    console.warn(`[docs:links] Help directory not found at ${HELP_ROOT}`);
    return;
  }

  const files = await findMdxFiles(HELP_ROOT);
  const errors: string[] = [];

  for (const file of files) {
    const raw = await fs.readFile(file, "utf8");
    const parsed = parseFrontmatter(raw);
    const links = extractLinks(parsed.content);
    for (const link of links) {
      const validation = validateLink(link.href);
      if (validation) {
        errors.push(`${file}@${link.index} -> ${link.href} (${validation})`);
      }
    }
  }

  if (errors.length > 0) {
    console.error(`[docs:links] Found ${errors.length} invalid link(s):`);
    errors.forEach((err) => console.error(`  - ${err}`));
    process.exitCode = 1;
    return;
  }

  console.log(`[docs:links] All links look good across ${files.length} file(s).`);
}

main().catch((err) => {
  console.error(`[docs:links] Failed:`, err);
  process.exitCode = 1;
});
