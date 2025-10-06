export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: any): any {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") {
    const out: Record<string, any> = {};
    for (const key of Object.keys(value).sort()) {
      out[key] = sortValue(value[key]);
    }
    return out;
  }
  return value;
}
