function sortValue(value: any): any {
  if (Array.isArray(value)) {
    return value.map(sortValue);
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value)
      .map(([k, v]) => [k, sortValue(v)] as const)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return entries.reduce<Record<string, any>>((acc, [k, v]) => {
      acc[k] = v;
      return acc;
    }, {});
  }
  return value;
}

export function canonicalJson(value: any): string {
  return JSON.stringify(sortValue(value));
}
