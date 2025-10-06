import { promises as fs } from 'fs';
import path from 'path';

export interface CodexManifestEntry {
  order: number;
  file_relative: string;
  part: number;
  parts: number;
  md_path: string;
  language: string;
  chars: number;
}

export interface CodexChunk {
  entry: CodexManifestEntry;
  text: string;
  path: string;
}

export interface CodexFile {
  fileRelative: string;
  language?: string;
  chars: number;
  parts: number;
  text: string;
  order: number;
}

export interface LoadOptions {
  manifestPath?: string;
  feedRoot?: string;
  filter?: (entry: CodexManifestEntry) => boolean;
}

const DEFAULT_FEED_ROOT = path.resolve(process.cwd(), 'docs/_codex_feed');
const DEFAULT_MANIFEST = path.join(DEFAULT_FEED_ROOT, 'manifest.json');

const BOM = '\uFEFF';

async function readManifest(manifestPath: string = DEFAULT_MANIFEST): Promise<CodexManifestEntry[]> {
  try {
    const contents = await fs.readFile(manifestPath, 'utf8');
    const normalized = contents.startsWith(BOM) ? contents.slice(1) : contents;
    const entries = JSON.parse(normalized) as CodexManifestEntry[];
    return entries;
  } catch (error) {
    throw new Error(`Unable to read Codex manifest at ${manifestPath}: ${(error as Error).message}`);
  }
}

function chunkFileName(entry: CodexManifestEntry): string {
  const order = entry.order.toString().padStart(4, '0');
  const part = entry.part.toString().padStart(2, '0');
  const parts = entry.parts.toString().padStart(2, '0');
  return `${order}_${entry.file_relative}_part_${part}of${parts}.md`;
}

async function readChunk(entry: CodexManifestEntry, feedRoot: string = DEFAULT_FEED_ROOT): Promise<CodexChunk> {
  const relativeName = chunkFileName(entry);
  const chunkPath = path.join(feedRoot, relativeName);
  try {
    const text = await fs.readFile(chunkPath, 'utf8');
    return {
      entry,
      text,
      path: chunkPath,
    };
  } catch (error) {
    throw new Error(`Unable to read Codex chunk ${relativeName}: ${(error as Error).message}`);
  }
}

export async function loadChunks(options: LoadOptions = {}): Promise<CodexChunk[]> {
  const manifestPath = options.manifestPath ?? DEFAULT_MANIFEST;
  const feedRoot = options.feedRoot ?? DEFAULT_FEED_ROOT;
  const entries = await readManifest(manifestPath);
  const filtered = options.filter ? entries.filter(options.filter) : entries;
  const chunks = await Promise.all(filtered.map((entry) => readChunk(entry, feedRoot)));
  return chunks;
}

export async function loadFiles(options: LoadOptions = {}): Promise<CodexFile[]> {
  const chunks = await loadChunks(options);
  const grouped = new Map<string, CodexFile>();

  for (const chunk of chunks) {
    const key = chunk.entry.file_relative;
    if (!grouped.has(key)) {
      grouped.set(key, {
        fileRelative: key,
        language: chunk.entry.language || undefined,
        chars: chunk.entry.chars,
        parts: chunk.entry.parts,
        text: chunk.text,
        order: chunk.entry.order,
      });
      continue;
    }

    const existing = grouped.get(key)!;
    existing.text += chunk.text;
    existing.parts = Math.max(existing.parts, chunk.entry.parts);
    existing.chars += chunk.entry.chars;
    existing.order = Math.min(existing.order, chunk.entry.order);
  }

  return Array.from(grouped.values()).sort((a, b) => a.order - b.order);
}

export async function loadCombinedText(options: LoadOptions = {}): Promise<string> {
  const feedRoot = options.feedRoot ?? DEFAULT_FEED_ROOT;
  const combinedPath = path.join(feedRoot, 'combined_all.md');
  try {
    return await fs.readFile(combinedPath, 'utf8');
  } catch (error) {
    throw new Error(`Unable to read combined Codex feed at ${combinedPath}: ${(error as Error).message}`);
  }
}
