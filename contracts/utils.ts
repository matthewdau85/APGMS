import crypto from "node:crypto";

export function describeValue(value: unknown): string {
  if (value === null) return "null";
  const t = typeof value;
  if (t === "string" || t === "number" || t === "boolean" || t === "bigint") {
    return t;
  }
  if (value instanceof Date) {
    return "Date";
  }
  if (ArrayBuffer.isView(value)) {
    const view = value as ArrayBufferView;
    return `${value.constructor.name}<length=${view.byteLength}>`;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return "array<empty>";
    const inner = describeValue(value[0]);
    return `array<${inner}>`;
  }
  if (t === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}:${describeValue(v)}`);
    return `object{${entries.join(",")}}`;
  }
  if (t === "undefined") return "undefined";
  if (t === "function") return "function";
  return "unknown";
}

export function canonicalize(value: unknown): unknown {
  if (value === null) return null;
  if (typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(canonicalize).sort((a, b) => {
      return JSON.stringify(a).localeCompare(JSON.stringify(b));
    });
  }
  const obj = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(obj)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => [k, canonicalize(v)])
  );
}

export function hashKey(parts: (string | number)[]): string {
  const h = crypto.createHash("sha256");
  for (const part of parts) {
    h.update(String(part));
    h.update("|");
  }
  return h.digest("hex");
}
