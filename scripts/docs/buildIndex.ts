import { promises as fs } from "fs";
import path from "path";
import { parseFrontmatter } from "./frontmatter";

const HELP_ROOT = path.resolve(process.cwd(), "docs/help");
const OUTPUT_PATH = path.resolve(process.cwd(), "src/help/HelpIndex.json");

interface LinkSummary {
  href: string;
  text: string;
}

interface BaseEntry {
  id: string;
  slug: string;
  title: string;
  tags: string[];
  lastUpdated?: string | null;
  summary: string;
  body: string;
  links: LinkSummary[];
}

interface HelpTopic extends BaseEntry {
  modes: string[];
}

interface WhatsNewEntry extends BaseEntry {
  date: string;
}

interface HelpIndex {
  generatedAt: string;
  topics: HelpTopic[];
  whatsNew: WhatsNewEntry[];
  tags: string[];
  modes: string[];
}

function toPlainText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/\[(.*?)\]\((.*?)\)/g, "$1")
    .replace(/![^\s]*\((.*?)\)/g, "")
    .replace(/^>\s?/gm, "")
    .replace(/^[-*+]\s+/gm, "")
    .replace(/^#+\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractLinks(markdown: string): LinkSummary[] {
  const links: LinkSummary[] = [];
  const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
  let match: RegExpExecArray | null;
  while ((match = linkRegex.exec(markdown)) !== null) {
    links.push({ href: match[2], text: match[1] });
  }
  return links;
}

async function parseMdxFile(file: string) {
  const raw = await fs.readFile(file, "utf8");
  const parsed = parseFrontmatter(raw);
  const trimmedContent = parsed.content.trim();
  const paragraphs = trimmedContent.split(/\n\s*\n/).filter((p) => p.trim());
  const summary = toPlainText(paragraphs[0] ?? "");
  const body = toPlainText(trimmedContent);
  const links = extractLinks(parsed.content);
  return { data: parsed.data, summary, body, links };
}

async function buildIndex() {
  try {
    await fs.access(HELP_ROOT);
  } catch (err) {
    console.warn(`[docs:index] Help directory not found at ${HELP_ROOT}`);
    process.exitCode = 1;
    return;
  }

  const entries = await fs.readdir(HELP_ROOT, { withFileTypes: true });
  const topicFiles: string[] = [];
  const whatsNewFiles: string[] = [];

  for (const entry of entries) {
    const full = path.join(HELP_ROOT, entry.name);
    if (entry.isFile() && entry.name.endsWith(".mdx")) {
      topicFiles.push(full);
    } else if (entry.isDirectory() && entry.name === "whats-new") {
      const wnEntries = await fs.readdir(full, { withFileTypes: true });
      for (const wn of wnEntries) {
        const wnPath = path.join(full, wn.name);
        if (wn.isFile() && wn.name.endsWith(".mdx")) {
          whatsNewFiles.push(wnPath);
        }
      }
    }
  }

  const topics: HelpTopic[] = [];
  const whatsNew: WhatsNewEntry[] = [];
  const tagSet = new Set<string>();
  const modeSet = new Set<string>();

  for (const file of topicFiles) {
    const { data, summary, body, links } = await parseMdxFile(file);
    const slug = path.relative(HELP_ROOT, file).replace(/\\/g, "/").replace(/\.mdx$/, "");
    const tags = Array.isArray(data.tags) ? data.tags.map(String) : [];
    const modes = Array.isArray(data.modes) ? data.modes.map(String) : [];
    const topic: HelpTopic = {
      id: slug,
      slug,
      title: String(data.title ?? slug),
      tags,
      modes,
      lastUpdated: data.lastUpdated ?? null,
      summary,
      body,
      links,
    };
    tags.forEach((tag) => tagSet.add(tag));
    modes.forEach((mode) => modeSet.add(mode));
    topics.push(topic);
  }

  for (const file of whatsNewFiles) {
    const { data, summary, body, links } = await parseMdxFile(file);
    const slug = path.relative(HELP_ROOT, file).replace(/\\/g, "/").replace(/\.mdx$/, "");
    const tags = Array.isArray(data.tags) ? data.tags.map(String) : [];
    const entry: WhatsNewEntry = {
      id: slug,
      slug,
      title: String(data.title ?? slug),
      date: String(data.date ?? ""),
      tags,
      lastUpdated: data.lastUpdated ?? null,
      summary: String(data.summary ?? summary ?? ""),
      body,
      links,
    };
    tags.forEach((tag) => tagSet.add(tag));
    whatsNew.push(entry);
  }

  topics.sort((a, b) => a.title.localeCompare(b.title));
  whatsNew.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  const index: HelpIndex = {
    generatedAt: new Date().toISOString(),
    topics,
    whatsNew,
    tags: Array.from(tagSet).sort((a, b) => a.localeCompare(b)),
    modes: Array.from(modeSet).sort((a, b) => a.localeCompare(b)),
  };

  await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await fs.writeFile(OUTPUT_PATH, JSON.stringify(index, null, 2));
  console.log(
    `[docs:index] Wrote ${OUTPUT_PATH} with ${topics.length} topics and ${whatsNew.length} release notes.`
  );
}

buildIndex().catch((err) => {
  console.error(`[docs:index] Failed:`, err);
  process.exitCode = 1;
});
