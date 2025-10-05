import type { AnomalyPort, AnomalyVector } from "../interfaces";
import { makeError, makeIdempotencyKey } from "./shared";
import { isAnomalous } from "../../src/anomaly/deterministic";

function score(vector: AnomalyVector): number {
  return (
    vector.variance_ratio * 0.4 +
    vector.dup_rate * 0.2 +
    Math.max(0, vector.gap_minutes - 30) / 100 +
    Math.abs(vector.delta_vs_baseline) * 0.3
  );
}

export async function createProvider(): Promise<AnomalyPort> {
  return {
    timeoutMs: 1200,
    retriableCodes: ["ANOMALY_RETRY"],
    async evaluate(vector) {
      validate(vector);
      return {
        anomalous: isAnomalous(vector),
        score: Number(score(vector).toFixed(4)),
      };
    },
    thresholds() {
      return {
        variance_ratio: 0.25,
        dup_rate: 0.05,
        gap_minutes: 60,
        delta_vs_baseline: 0.1,
      };
    },
    async simulateError(kind) {
      switch (kind) {
        case "timeout":
          return makeError("ANOMALY_TIMEOUT", "Anomaly scoring timed out", true, 504);
        case "invalid":
        default:
          return makeError("ANOMALY_INVALID", "Vector contained NaN", false, 400);
      }
    },
    idempotencyKey(vector) {
      return makeIdempotencyKey([
        vector.variance_ratio.toFixed(4),
        vector.dup_rate.toFixed(4),
        vector.gap_minutes,
        vector.delta_vs_baseline.toFixed(4),
      ]);
    },
  };
}

function validate(vector: AnomalyVector) {
  const values = Object.values(vector);
  if (values.some((v) => !Number.isFinite(v))) {
    const err = makeError("ANOMALY_INVALID", "Vector contained NaN", false, 400);
    throw Object.assign(new Error(err.message), err);
  }
}

export default createProvider;
