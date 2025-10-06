import { promises as fs } from "fs";
import path from "path";

interface RawManifestEntry {
  order: number;
  file_relative: string;
  part: number;
  parts: number;
  chars: number;
}

export interface CodexManifestEntry {
  order: number;
  fileRelative: string;
  part: number;
  parts: number;
  charCount: number;
  fileName: string;
}

export interface CodexChunk extends CodexManifestEntry {
  title?: string;
  content: string;
  preview: string;
}

const FEED_DIR = path.resolve(process.cwd(), "docs", "_codex_feed");
const MANIFEST_PATH = path.join(FEED_DIR, "manifest.json");

interface InternalManifestEntry extends CodexManifestEntry {
  filePath: string;
}

let manifestCache: InternalManifestEntry[] | null = null;
let manifestLookup: Map<number, InternalManifestEntry> | null = null;

function ensureFeedDir() {
  return FEED_DIR;
}

function deriveFileName(entry: RawManifestEntry): string {
  const order = String(entry.order).padStart(4, "0");
  const part = String(entry.part).padStart(2, "0");
  const parts = String(entry.parts).padStart(2, "0");
  return `${order}_${entry.file_relative}_part_${part}of${parts}.md`;
}

async function loadManifestFromDisk(): Promise<InternalManifestEntry[]> {
  const dir = ensureFeedDir();
  const raw = await fs.readFile(MANIFEST_PATH, "utf8");
  const cleaned = raw.replace(/^\uFEFF/, "");
  const parsed = JSON.parse(cleaned) as RawManifestEntry[];
  return parsed.map((entry) => {
    const fileName = deriveFileName(entry);
    const filePath = path.join(dir, fileName);
    return {
      order: entry.order,
      fileRelative: entry.file_relative,
      part: entry.part,
      parts: entry.parts,
      charCount: entry.chars,
      fileName,
      filePath,
    } satisfies InternalManifestEntry;
  });
}

async function ensureManifestLoaded(): Promise<InternalManifestEntry[]> {
  if (manifestCache) {
    return manifestCache;
  }
  const manifest = await loadManifestFromDisk();
  manifestCache = manifest;
  manifestLookup = new Map(manifest.map((entry) => [entry.order, entry]));
  return manifest;
}

function toExternal(entry: InternalManifestEntry): CodexManifestEntry {
  const { filePath: _filePath, ...external } = entry;
  return external;
}

function sanitizeContent(raw: string): string {
  const withoutBom = raw.replace(/^\uFEFF/, "");
  const codeFenceMatch = [...withoutBom.matchAll(/```([\s\S]*?)```/g)];
  if (codeFenceMatch.length > 0) {
    return codeFenceMatch.map((m) => m[1]).join("\n\n").trim();
  }
  return withoutBom.trim();
}

function extractTitle(raw: string): string | undefined {
  const withoutBom = raw.replace(/^\uFEFF/, "");
  const match = withoutBom.match(/^#\s+File:\s+(.+)$/m);
  return match ? match[1].trim() : undefined;
}

function buildPreview(content: string, maxLength: number): string {
  const normalized = content.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

export async function getManifest(): Promise<CodexManifestEntry[]> {
  const manifest = await ensureManifestLoaded();
  return manifest.map(toExternal);
}

export async function getChunk(order: number, previewLength = 240): Promise<CodexChunk> {
  if (!Number.isInteger(order) || order < 1) {
    throw new Error("ORDER_OUT_OF_RANGE");
  }
  await ensureManifestLoaded();
  const entry = manifestLookup?.get(order);
  if (!entry) {
    throw new Error("ORDER_NOT_FOUND");
  }
  let raw: string;
  try {
    raw = await fs.readFile(entry.filePath, "utf8");
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err?.code === "ENOENT") {
      throw new Error("CHUNK_FILE_MISSING");
    }
    throw error;
  }
  const content = sanitizeContent(raw);
  const title = extractTitle(raw);
  const preview = buildPreview(content, previewLength);
  return {
    ...toExternal(entry),
    title,
    content,
    preview,
  };
}

export async function getChunksPreview(orders: number[], previewLength = 240): Promise<CodexChunk[]> {
  const uniqueOrders = Array.from(new Set(orders));
  const chunks = await Promise.all(uniqueOrders.map((order) => getChunk(order, previewLength)));
  const lookup = new Map(chunks.map((chunk) => [chunk.order, chunk]));
  return orders
    .map((order) => lookup.get(order))
    .filter((chunk): chunk is CodexChunk => Boolean(chunk));
}
