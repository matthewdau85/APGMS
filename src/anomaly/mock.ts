import {
  AnomalyAssessment,
  AnomalyDecision,
  AnomalyPort,
  AnomalyVector,
  ThresholdOverrides,
  resolveThresholds,
} from "./port";

interface MockConfig {
  nearFraction: number;
  forceNear: boolean;
  forceBlock: boolean;
}

const config: MockConfig = {
  nearFraction: clampFraction(Number(process.env.ANOMALY_MOCK_NEAR_FRACTION ?? "0.9")),
  forceNear: parseBoolean(process.env.ANOMALY_MOCK_FORCE_NEAR),
  forceBlock: parseBoolean(process.env.ANOMALY_MOCK_FORCE_BLOCK),
};

export class MockAnomalyPort implements AnomalyPort {
  async evaluate(vector: AnomalyVector, overrides: ThresholdOverrides = {}): Promise<AnomalyAssessment> {
    const thresholds = resolveThresholds(overrides);
    const breaches: string[] = [];
    const near: string[] = [];

    evaluateMetric("variance_ratio", vector.variance_ratio, thresholds.variance_ratio, breaches, near);
    evaluateMetric("dup_rate", vector.dup_rate, thresholds.dup_rate, breaches, near);
    evaluateMetric("gap_minutes", vector.gap_minutes, thresholds.gap_minutes, breaches, near);
    evaluateMetric("delta_vs_baseline", Math.abs(vector.delta_vs_baseline), thresholds.delta_vs_baseline, breaches, near);

    let decision: AnomalyDecision = "CLEAR";
    if (config.forceBlock) {
      decision = "BLOCK";
      if (breaches.length === 0) breaches.push("chaos:force-block");
    } else if (config.forceNear) {
      decision = "NEAR";
      if (near.length === 0) near.push("chaos:force-near");
    } else if (breaches.length > 0) {
      decision = "BLOCK";
    } else if (near.length > 0) {
      decision = "NEAR";
    }

    return { decision, breaches, near, vector, thresholds };
  }
}

export const mockAnomalyPort = new MockAnomalyPort();

function evaluateMetric(
  name: keyof AnomalyVector,
  observed: number,
  threshold: number,
  breaches: string[],
  near: string[],
) {
  if (Number.isNaN(observed)) return;
  if (observed > threshold) {
    breaches.push(name);
    return;
  }
  const nearCutoff = threshold * config.nearFraction;
  if (nearCutoff === 0) return;
  if (observed > nearCutoff) {
    near.push(name);
  }
}

function clampFraction(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0.9;
  if (value >= 1) return 0.99;
  return value;
}

function parseBoolean(value: string | undefined): boolean {
  if (!value) return false;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}
