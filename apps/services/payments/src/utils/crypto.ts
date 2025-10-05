import pg from "pg";
import { createHash } from "crypto";

export function sha256Hex(input: string | Buffer): string {
  return createHash("sha256").update(input).digest("hex");
}

export function canonicalJson(obj: any): string {
  return JSON.stringify(sortKeysDeep(obj));
}

function sortKeysDeep(value: any): any {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value && typeof value === "object") {
    const out: Record<string, any> = {};
    Object.keys(value).sort().forEach(k => { out[k] = sortKeysDeep(value[k]); });
    return out;
  }
  return value;
}
