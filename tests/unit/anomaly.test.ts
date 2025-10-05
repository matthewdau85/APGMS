import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isAnomalous, AnomalyVector } from "../../src/anomaly/deterministic";

describe("isAnomalous", () => {
  const baseline: AnomalyVector = {
    variance_ratio: 0.1,
    dup_rate: 0.01,
    gap_minutes: 15,
    delta_vs_baseline: 0.05,
  };

  it("returns false when metrics are within default tolerances", () => {
    assert.equal(isAnomalous(baseline), false);
  });

  it("flags anomalies when any dimension exceeds the default threshold", () => {
    const spike: AnomalyVector = { ...baseline, variance_ratio: 0.5 };
    assert.equal(isAnomalous(spike), true);
  });

  it("uses caller-provided thresholds before flagging", () => {
    const overrides = { variance_ratio: 0.6 };
    const spike: AnomalyVector = { ...baseline, variance_ratio: 0.55 };
    assert.equal(isAnomalous(spike, overrides), false);
    assert.equal(isAnomalous(spike, { variance_ratio: 0.5 }), true);
  });
});
