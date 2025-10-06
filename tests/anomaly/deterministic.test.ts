import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { exceeds, isAnomalous } from "../../src/anomaly/deterministic";

describe("deterministic anomaly checks", () => {
  it("flags vectors exceeding provided thresholds", () => {
    const vector = {
      variance_ratio: 0.3,
      dup_rate: 0.02,
      gap_minutes: 15,
      delta_vs_baseline: 0.15,
    };

    assert.equal(
      exceeds(vector, {
        variance_ratio: 0.35,
        dup_rate: 0.05,
        gap_minutes: 60,
        delta_vs_baseline: 0.2,
      }),
      false,
      "vector should not exceed relaxed thresholds",
    );

    assert.equal(
      exceeds(vector, {
        variance_ratio: 0.25,
        dup_rate: 0.01,
        gap_minutes: 60,
        delta_vs_baseline: 0.2,
      }),
      true,
      "higher variance ratio should trip guard",
    );
  });

  it("falls back to defaults for missing metrics", () => {
    const sparseVector = { variance_ratio: 0.1 };

    assert.equal(isAnomalous({
      variance_ratio: 0.1,
      dup_rate: 0.01,
      gap_minutes: 5,
      delta_vs_baseline: 0.05,
    }), false, "baseline vector should be considered normal");

    assert.equal(
      exceeds(sparseVector, {}),
      false,
      "sparse vector should normalise missing fields",
    );

    assert.equal(
      exceeds({ delta_vs_baseline: 0.5 }, {}),
      true,
      "large delta_vs_baseline should be anomalous",
    );
  });
});
