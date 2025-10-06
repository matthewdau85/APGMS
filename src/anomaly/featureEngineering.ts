import { NumericVector } from "./isolationForest";

export interface ReconEventInput {
  id: unknown;
  amount: unknown;
  hour_of_day: unknown;
  day_of_week: unknown;
  channel: unknown;
  payer_hash: unknown;
  CRN_valid: unknown;
  period_state: unknown;
}

export interface PreparedReconEvent {
  id: string;
  vector: NumericVector;
  features: {
    amount: number;
    hour_of_day: number;
    day_of_week: number;
    channel: string;
    payer_hash: string;
    CRN_valid: boolean;
    period_state: string;
  };
  duplicateKey: string;
}

export function prepareReconEvents(events: ReconEventInput[]): PreparedReconEvent[] {
  interface WorkingEvent {
    id: string;
    rawVector: NumericVector;
    features: PreparedReconEvent["features"];
    duplicateKey: string;
  }

  const cleaned: WorkingEvent[] = [];

  for (const raw of events) {
    if (!raw || typeof raw !== "object") {
      continue;
    }
    const id = String((raw as { id?: unknown }).id ?? "").trim();
    if (!id) {
      continue;
    }

    const amount = toFiniteNumber((raw as { amount?: unknown }).amount);
    const hour_of_day = clampInteger((raw as { hour_of_day?: unknown }).hour_of_day, 0, 23);
    const day_of_week = clampInteger((raw as { day_of_week?: unknown }).day_of_week, 0, 6);
    const channel = String((raw as { channel?: unknown }).channel ?? "unknown").trim() || "unknown";
    const payer_hash = String((raw as { payer_hash?: unknown }).payer_hash ?? "unknown").trim() || "unknown";
    const period_state = String((raw as { period_state?: unknown }).period_state ?? "unspecified").trim() || "unspecified";
    const CRN_valid = toBoolean((raw as { CRN_valid?: unknown }).CRN_valid);

    if (!Number.isFinite(amount) || hour_of_day === null || day_of_week === null) {
      continue;
    }

    const rawVector: NumericVector = [
      transformedAmount(amount),
      hour_of_day,
      day_of_week,
      hashToUnit(channel),
      hashToUnit(payer_hash),
      CRN_valid ? 1 : 0,
      hashToUnit(period_state),
    ];

    cleaned.push({
      id,
      rawVector,
      features: { amount, hour_of_day, day_of_week, channel, payer_hash, CRN_valid, period_state },
      duplicateKey: [
        payer_hash,
        channel,
        period_state,
        day_of_week,
        hour_of_day,
        roundKey(amount),
        CRN_valid ? "1" : "0",
      ].join("|"),
    });
  }

  if (!cleaned.length) {
    return [];
  }

  const scaled = scaleVectors(cleaned.map((row) => row.rawVector));
  return cleaned.map((row, idx) => ({
    id: row.id,
    vector: scaled[idx],
    features: row.features,
    duplicateKey: row.duplicateKey,
  }));
}

function scaleVectors(vectors: NumericVector[]): NumericVector[] {
  if (!vectors.length) {
    return [];
  }
  const dimension = vectors[0].length;
  const minValues = new Array<number>(dimension).fill(Number.POSITIVE_INFINITY);
  const maxValues = new Array<number>(dimension).fill(Number.NEGATIVE_INFINITY);

  for (const row of vectors) {
    for (let i = 0; i < dimension; i += 1) {
      const value = row[i];
      if (value < minValues[i]) minValues[i] = value;
      if (value > maxValues[i]) maxValues[i] = value;
    }
  }

  return vectors.map((row) =>
    row.map((value, i) => {
      const min = minValues[i];
      const max = maxValues[i];
      if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) {
        return 0.5;
      }
      return (value - min) / (max - min);
    }),
  );
}

function transformedAmount(amount: number): number {
  const magnitude = Math.log10(Math.abs(amount) + 1);
  return amount < 0 ? -magnitude : magnitude;
}

function toFiniteNumber(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return null;
  }
  return num;
}

function clampInteger(value: unknown, min: number, max: number): number | null {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return null;
  }
  const rounded = Math.round(num);
  if (rounded < min || rounded > max) {
    return null;
  }
  return rounded;
}

function toBoolean(value: unknown): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  if (typeof value === "string") {
    const lower = value.trim().toLowerCase();
    return ["y", "yes", "1", "true", "valid"].includes(lower);
  }
  return false;
}

function hashToUnit(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0; // force 32-bit
  }
  const normalized = (hash >>> 0) % 10007;
  return normalized / 10007;
}

function roundKey(amount: number): string {
  return amount.toFixed(2);
}
