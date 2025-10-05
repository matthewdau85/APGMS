import { AnomalyEvaluation, AnomalyProvider, AnomalyProviderError, Thresholds } from "@core/ports";

function ensureVector(vector: Partial<Record<keyof Thresholds, number>>): Record<string, number> {
  return {
    variance_ratio: vector.variance_ratio ?? 0,
    dup_rate: vector.dup_rate ?? 0,
    gap_minutes: vector.gap_minutes ?? 0,
    delta_vs_baseline: vector.delta_vs_baseline ?? 0,
  };
}

export function createDeterministicAnomalyProvider(): AnomalyProvider {
  return {
    async evaluate(vector, thresholds = {}): Promise<AnomalyEvaluation> {
      if (!vector) {
        throw new AnomalyProviderError("VECTOR_REQUIRED");
      }
      const v = ensureVector(vector);
      const triggers: string[] = [];
      if (v.variance_ratio > (thresholds.variance_ratio ?? 0.25)) triggers.push("variance_ratio");
      if (v.dup_rate > (thresholds.dup_rate ?? 0.05)) triggers.push("dup_rate");
      if (v.gap_minutes > (thresholds.gap_minutes ?? 60)) triggers.push("gap_minutes");
      if (Math.abs(v.delta_vs_baseline) > (thresholds.delta_vs_baseline ?? 0.1)) triggers.push("delta_vs_baseline");
      return { anomalous: triggers.length > 0, triggers };
    },
  };
}
