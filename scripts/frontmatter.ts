export type FrontMatter = Record<string, unknown>;

export function splitFrontMatter(source: string): { frontMatter: FrontMatter; body: string } {
  const match = source.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) {
    return { frontMatter: {}, body: source };
  }
  const metadata = parseBlock(match[1]);
  const body = source.slice(match[0].length);
  return { frontMatter: metadata, body };
}

export function parseBlock(block: string): FrontMatter {
  const lines = block.split(/\n/);
  const data: FrontMatter = {};
  let currentKey: string | null = null;
  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/^[^\s].*:\s*/.test(line)) {
      const [key, ...rest] = line.split(":");
      currentKey = key.trim();
      const value = rest.join(":").trim();
      if (!value) {
        data[currentKey] = [];
        continue;
      }
      if (value.startsWith("[") && value.endsWith("]")) {
        const list = value
          .slice(1, -1)
          .split(/,\s*/)
          .filter(Boolean)
          .map(unquote);
        data[currentKey] = list;
      } else if (value === "true" || value === "false") {
        data[currentKey] = value === "true";
      } else {
        data[currentKey] = unquote(value);
      }
    } else if (trimmed.startsWith("-")) {
      if (!currentKey) continue;
      const entry = trimmed.replace(/^-\s*/, "");
      const list = (data[currentKey] as unknown[]) ?? [];
      if (!Array.isArray(list)) {
        data[currentKey] = [String(data[currentKey]), unquote(entry)];
      } else {
        list.push(unquote(entry));
        data[currentKey] = list;
      }
    }
  }
  return data;
}

export function serializeFrontMatter(data: FrontMatter): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(data)) {
    if (Array.isArray(value)) {
      parts.push(`${key}:`);
      for (const entry of value) {
        parts.push(`  - ${entry}`);
      }
    } else if (value === undefined) {
      continue;
    } else {
      parts.push(`${key}: ${stringifyValue(value)}`);
    }
  }
  return parts.join("\n");
}

function stringifyValue(value: unknown): string {
  if (typeof value === "string") {
    if (/[:#]|^\s|\s$/.test(value)) {
      return JSON.stringify(value);
    }
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  return JSON.stringify(value);
}

function unquote(value: string): string {
  if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}
