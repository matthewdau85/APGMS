import assert from "node:assert/strict";
import type { AnomalyPort, AnomalyVector } from "./interfaces";
import type { ContractSpec } from "./types";
import { makeReport } from "./types";
import { describeValue } from "./utils";

const spec: ContractSpec = async (ctx) => {
  const provider = await ctx.load<AnomalyPort>();
  const vector: AnomalyVector = {
    variance_ratio: 0.3,
    dup_rate: 0.01,
    gap_minutes: 20,
    delta_vs_baseline: 0.12,
  };

  const result = await provider.evaluate(vector);
  assert.equal(typeof result.anomalous, "boolean");
  assert.equal(typeof result.score, "number");

  const thresholds = provider.thresholds();
  assert.ok(Object.keys(thresholds).length >= 1);

  const invalid = await provider.simulateError("invalid");
  assert.equal(invalid.code, "ANOMALY_INVALID");
  assert.equal(invalid.retriable, false);

  const timeout = await provider.simulateError("timeout");
  assert.equal(timeout.code, "ANOMALY_TIMEOUT");
  assert.equal(timeout.retriable, true);

  assert.ok(provider.timeoutMs > 0);

  return makeReport(ctx, {
    responseTypes: {
      evaluate: describeValue(result),
      thresholds: describeValue(thresholds),
    },
    errors: {
      invalid,
      timeout,
    },
    idempotency: {
      evaluate: provider.idempotencyKey(vector),
    },
    timeoutMs: provider.timeoutMs,
    retriableCodes: [...provider.retriableCodes].sort(),
  });
};

export default spec;
