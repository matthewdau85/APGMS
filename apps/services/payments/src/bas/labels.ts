import basLabelMap from "./bas_labels.json" assert { type: "json" };

export type TaxType = "GST" | "PAYGW";
export type DomainTotals = Record<string, number>;
export type LabelTotals = Record<string, number>;

type RawMap = Record<TaxType, Record<string, string>>;
const mapping = basLabelMap as RawMap;

export function assertTaxType(value: string): asserts value is TaxType {
  if (value !== "GST" && value !== "PAYGW") {
    throw new Error(`Unsupported taxType '${value}'`);
  }
}

export function normalizeDomainTotals(taxType: TaxType, totals: Record<string, unknown>): DomainTotals {
  const domainMap = mapping[taxType];
  if (!domainMap) throw new Error(`No BAS mapping configured for ${taxType}`);
  if (!totals || typeof totals !== "object") {
    throw new Error("domainTotals must be an object");
  }

  const out: DomainTotals = {};
  for (const key of Object.keys(domainMap)) {
    const raw = (totals as Record<string, unknown>)[key];
    const num = raw == null ? 0 : Number(raw);
    if (raw != null && !Number.isFinite(num)) {
      throw new Error(`domainTotals.${key} must be numeric`);
    }
    out[key] = Math.trunc(num);
  }

  for (const key of Object.keys(totals)) {
    if (!(key in domainMap)) {
      throw new Error(`Unknown domain total '${key}' for taxType ${taxType}`);
    }
  }

  return out;
}

export function coerceNumericRecord(value: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!value || typeof value !== "object") return out;
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const num = Number(raw);
    if (Number.isFinite(num)) out[key] = Math.trunc(num);
  }
  return out;
}

export function projectToLabels(taxType: TaxType, domainTotals: DomainTotals): LabelTotals {
  const domainMap = mapping[taxType];
  const labels: LabelTotals = {};
  for (const [domain, amount] of Object.entries(domainTotals)) {
    const label = domainMap[domain];
    labels[label] = (labels[label] ?? 0) + amount;
  }
  for (const label of Object.values(domainMap)) {
    if (!(label in labels)) labels[label] = 0;
  }
  return labels;
}

export function diffTotals(before: Record<string, number>, after: Record<string, number>): Record<string, number> {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const out: Record<string, number> = {};
  for (const key of keys) {
    const prev = Number(before[key] ?? 0);
    const next = Number(after[key] ?? 0);
    out[key] = Math.trunc(next - prev);
  }
  return out;
}

export function computeNetLiability(taxType: TaxType, labels: Record<string, number>): number {
  if (taxType === "GST") {
    const oneA = Number(labels["1A"] ?? 0);
    const oneB = Number(labels["1B"] ?? 0);
    return Math.trunc(oneA - oneB);
  }
  if (taxType === "PAYGW") {
    const w2 = Number(labels["W2"] ?? 0);
    return Math.trunc(w2);
  }
  return 0;
}

export function buildLabelResponse(taxType: TaxType, labels: Record<string, number | null | undefined>): Record<string, number | null> {
  const domainMap = mapping[taxType];
  if (!domainMap) return {};
  const result: Record<string, number | null> = {};
  for (const label of Object.values(domainMap)) {
    const raw = labels[label];
    result[label] = raw == null ? null : Math.trunc(Number(raw));
  }
  return result;
}

export const basLabelMapping: RawMap = mapping;
