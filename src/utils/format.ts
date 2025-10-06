// src/utils/format.ts
export function formatCurrencyFromCents(cents: number, locale = "en-AU", currency = "AUD"): string {
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(cents / 100);
}

export function formatDate(value: string, locale = "en-AU"): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(locale, { year: "numeric", month: "short", day: "numeric" });
}
