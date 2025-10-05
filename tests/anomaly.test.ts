import assert from "assert";
import { isAnomalous } from "../src/anomaly/deterministic";
import {
  enqueuePendingAnomaly,
  listPendingAnomalies,
  resetPendingAnomalies
} from "../src/anomaly/pendingQueue";

const createRng = (seed: number) => {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
};

const rng = createRng(0x5eed);
const baseline = 125_000;
const sigmaThreshold = 3.0;
const materiality = 500;
const totals = Array.from({ length: 8 }, () => Math.round(baseline + (rng() - 0.5) * 25_000));

const evaluations = totals.map(total =>
  isAnomalous.evaluate(total, baseline, sigmaThreshold, materiality)
);

const flaggedCount = evaluations.filter(result => result.flagged).length;
const quietCount = evaluations.length - flaggedCount;

assert.ok(flaggedCount >= 1, "expected at least one anomaly");
assert.ok(quietCount >= 1, "expected at least one non-anomalous sample");

const firstFlagged = evaluations.find(result => result.flagged)!;
const firstQuiet = evaluations.find(result => !result.flagged)!;

assert.ok(firstFlagged.zScore >= sigmaThreshold, "flagged sample respects sigma threshold");
assert.ok(firstQuiet.zScore < sigmaThreshold, "non-flagged sample stays under sigma threshold");

resetPendingAnomalies();

evaluations.forEach((evaluation, index) => {
  if (evaluation.flagged) {
    enqueuePendingAnomaly({
      abn: "11111111111",
      taxType: "GST",
      periodId: `2025Q${index + 1}`,
      observedCents: totals[index],
      baselineCents: baseline,
      sigmaThreshold: evaluation.sigmaThreshold,
      materialityCents: evaluation.materialityThreshold,
      zScore: evaluation.zScore,
      deviationCents: evaluation.deviation,
      note: "seeded-test",
      provenance: "unit-test"
    });
  }
});

const queued = listPendingAnomalies();
assert.strictEqual(queued.length, flaggedCount, "all flagged entries should be queued");
assert.ok(queued.every(item => item.operatorNote === "seeded-test"), "notes stored from enqueue");

console.log("anomaly tests passed");
