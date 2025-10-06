import { promises as fs } from "fs";
import path from "path";
import { splitFrontMatter } from "./frontmatter";

type DocRecord = {
  slug: string;
  title: string;
  summary?: string;
  modes?: string[];
  content: string;
  updatedAt?: string;
};

const DOCS_DIR = path.resolve("docs/help");
const OUT_FILE = path.resolve("public/help/help-index.json");

async function readDocs(): Promise<DocRecord[]> {
  const entries: DocRecord[] = [];
  const filenames = await fs.readdir(DOCS_DIR);
  for (const filename of filenames) {
    if (!filename.endsWith(".mdx")) continue;
    const filePath = path.join(DOCS_DIR, filename);
    const raw = await fs.readFile(filePath, "utf8");
    const record = parseMdx(raw, filePath);
    entries.push(record);
  }
  entries.sort((a, b) => a.slug.localeCompare(b.slug));
  return entries;
}

function parseMdx(source: string, filePath: string): DocRecord {
  const { frontMatter, body } = splitFrontMatter(source);
  const slug = (frontMatter.slug as string) ?? raise(`Missing slug in ${filePath}`);
  const title = (frontMatter.title as string) ?? raise(`Missing title in ${filePath}`);
  const summary = frontMatter.summary as string | undefined;
  const modes = Array.isArray(frontMatter.modes)
    ? (frontMatter.modes as string[])
    : frontMatter.modes
    ? [String(frontMatter.modes)]
    : undefined;
  const updatedAt = frontMatter.lastUpdated as string | undefined;

  return {
    slug,
    title,
    summary,
    modes,
    updatedAt,
    content: body.trim(),
  };
}

function raise(message: string): never {
  throw new Error(message);
}

async function ensureOutDir() {
  const dir = path.dirname(OUT_FILE);
  await fs.mkdir(dir, { recursive: true });
}

async function main() {
  await ensureOutDir();
  const docs = await readDocs();
  await fs.writeFile(OUT_FILE, JSON.stringify({ docs }, null, 2));
  console.log(`Wrote ${docs.length} help docs to ${OUT_FILE}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
