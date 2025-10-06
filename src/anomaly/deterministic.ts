export interface AnomalyVector {
  variance_ratio: number;
  dup_rate: number;
  gap_minutes: number;
  delta_vs_baseline: number;
}

export interface Thresholds {
  variance_ratio?: number;
  dup_rate?: number;
  gap_minutes?: number;
  delta_vs_baseline?: number;
  epsilon_cents?: number;
}

export interface ReconLedgerEntry {
  amount_cents: number;
  bank_receipt_hash?: string | null;
  created_at?: string | null;
}

export interface ReconTotals {
  credited_cents: number;
  net_cents: number;
}

export function computeAnomalyVector(
  entries: ReconLedgerEntry[],
  totals: ReconTotals,
  baselineCents: number
): AnomalyVector {
  const creditAmounts = entries
    .filter((e) => e.amount_cents > 0)
    .map((e) => e.amount_cents);

  const mean = creditAmounts.length
    ? creditAmounts.reduce((acc, amt) => acc + amt, 0) / creditAmounts.length
    : 0;
  const variance = creditAmounts.length
    ? creditAmounts.reduce((acc, amt) => acc + Math.pow(amt - mean, 2), 0) /
      creditAmounts.length
    : 0;
  const stddev = Math.sqrt(variance);
  const varianceRatio = mean === 0 ? 0 : stddev / Math.abs(mean);

  const receiptHashes = entries
    .filter((e) => e.amount_cents > 0 && e.bank_receipt_hash)
    .map((e) => e.bank_receipt_hash as string);
  const uniqueReceipts = new Set(receiptHashes);
  const dupRate = receiptHashes.length === 0
    ? 0
    : (receiptHashes.length - uniqueReceipts.size) / receiptHashes.length;

  const timestamps = entries
    .map((e) => (e.created_at ? Date.parse(e.created_at) : NaN))
    .filter((ts) => !Number.isNaN(ts));
  const gapMinutes = timestamps.length > 1
    ? Math.abs(Math.max(...timestamps) - Math.min(...timestamps)) / 60000
    : 0;

  const baseline = baselineCents === 0 ? 0 : baselineCents;
  const deltaVsBaseline = baseline === 0
    ? totals.net_cents === 0
      ? 0
      : 1
    : (totals.net_cents - baseline) / baseline;

  return {
    variance_ratio: Number(varianceRatio.toFixed(6)),
    dup_rate: Number(dupRate.toFixed(6)),
    gap_minutes: Number(gapMinutes.toFixed(3)),
    delta_vs_baseline: Number(deltaVsBaseline.toFixed(6)),
  };
}

export function evaluateAnomaly(
  vector: AnomalyVector,
  thresholds: Thresholds = {}
): { breach: boolean; code?: string } {
  if (vector.variance_ratio > (thresholds.variance_ratio ?? 0.25)) {
    return { breach: true, code: "VARIANCE_RATIO" };
  }
  if (vector.dup_rate > (thresholds.dup_rate ?? 0.05)) {
    return { breach: true, code: "DUPLICATE_RATE" };
  }
  if (vector.gap_minutes > (thresholds.gap_minutes ?? 60)) {
    return { breach: true, code: "SETTLEMENT_GAP" };
  }
  if (Math.abs(vector.delta_vs_baseline) > (thresholds.delta_vs_baseline ?? 0.1)) {
    return { breach: true, code: "DELTA_BASELINE" };
  }
  return { breach: false };
}

export function isAnomalous(v: AnomalyVector, thr: Thresholds = {}): boolean {
  return evaluateAnomaly(v, thr).breach;
}
