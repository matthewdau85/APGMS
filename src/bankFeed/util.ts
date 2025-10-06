export function normalizeReference(value: string | null | undefined): string | null {
  if (!value) return null;
  const cleaned = value.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
  return cleaned || null;
}
