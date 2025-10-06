export function sortKeysDeep(value: any): any {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value && typeof value === "object") {
    const out: Record<string, any> = {};
    for (const key of Object.keys(value).sort()) {
      out[key] = sortKeysDeep(value[key]);
    }
    return out;
  }
  return value;
}

export function canonicalJson(value: any): string {
  return JSON.stringify(sortKeysDeep(value));
}
