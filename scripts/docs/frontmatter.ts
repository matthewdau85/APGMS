export interface FrontmatterResult {
  data: Record<string, any>;
  content: string;
  keys: string[];
}

function parseScalar(value: string): any {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  if (trimmed === "null") {
    return null;
  }
  if ((trimmed.startsWith("\"") && trimmed.endsWith("\"")) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }
  return trimmed;
}

export function parseFrontmatter(raw: string): FrontmatterResult {
  if (!raw.startsWith("---")) {
    return { data: {}, content: raw, keys: [] };
  }

  const closingIndex = raw.indexOf("\n---", 3);
  if (closingIndex === -1) {
    return { data: {}, content: raw, keys: [] };
  }

  const header = raw.slice(3, closingIndex).trim();
  const content = raw.slice(closingIndex + 4);
  const lines = header.split(/\r?\n/);

  const data: Record<string, any> = {};
  const keys: string[] = [];
  let currentKey: string | null = null;

  for (const line of lines) {
    if (!line.trim()) {
      continue;
    }
    const keyMatch = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
    if (keyMatch) {
      const [, key, value] = keyMatch;
      keys.push(key);
      if (value === "") {
        data[key] = [];
        currentKey = key;
      } else {
        data[key] = parseScalar(value);
        currentKey = null;
      }
      continue;
    }
    if (currentKey && line.trim().startsWith("-")) {
      const item = line.trim().slice(1).trim();
      if (!Array.isArray(data[currentKey])) {
        data[currentKey] = [];
      }
      (data[currentKey] as any[]).push(parseScalar(item));
      continue;
    }
  }

  return { data, content, keys };
}

function formatScalar(value: any): string {
  if (value === null) {
    return "null";
  }
  if (typeof value === "string") {
    if (value === "") {
      return "\"\"";
    }
    if (/[:#\-]/.test(value) || value.includes(" ")) {
      return `"${value.replace(/\"/g, '\\"')}"`;
    }
    return value;
  }
  return String(value);
}

export function stringifyFrontmatter(
  data: Record<string, any>,
  content: string,
  keys: string[]
): string {
  const uniqueKeys = Array.from(new Set([...keys, ...Object.keys(data)]));
  const lines: string[] = ["---"];

  for (const key of uniqueKeys) {
    const value = data[key];
    if (Array.isArray(value)) {
      lines.push(`${key}:`);
      for (const item of value) {
        lines.push(`  - ${formatScalar(item)}`);
      }
    } else {
      lines.push(`${key}: ${formatScalar(value)}`);
    }
  }

  lines.push("---");

  if (!content.startsWith("\n")) {
    return `${lines.join("\n")}\n\n${content}`;
  }

  return `${lines.join("\n")}${content}`;
}
