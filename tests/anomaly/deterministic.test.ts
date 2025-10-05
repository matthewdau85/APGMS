import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isAnomalous, AnomalyVector, Thresholds } from "../../src/anomaly/deterministic";

describe("isAnomalous", () => {
  const baseVector: AnomalyVector = {
    variance_ratio: 0.1,
    dup_rate: 0.02,
    gap_minutes: 10,
    delta_vs_baseline: 0.02,
  };

  it("returns false when metrics are within defaults", () => {
    const result = isAnomalous(baseVector);
    assert.equal(result, false);
  });

  it("returns true when a metric exceeds provided thresholds", () => {
    const thresholds: Thresholds = { variance_ratio: 0.05 };
    const result = isAnomalous({ ...baseVector, variance_ratio: 0.5 }, thresholds);
    assert.equal(result, true);
  });
});
