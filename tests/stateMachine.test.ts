import { strict as assert } from "node:assert";

import { nextState, PeriodState } from "../src/recon/stateMachine";

const cases: Array<[PeriodState, string, PeriodState]> = [
  ["OPEN", "CLOSE", "CLOSING"],
  ["CLOSING", "PASS", "READY_RPT"],
  ["CLOSING", "FAIL_DISCREPANCY", "BLOCKED_DISCREPANCY"],
  ["CLOSING", "FAIL_ANOMALY", "BLOCKED_ANOMALY"],
  ["READY_RPT", "RELEASE", "RELEASED"],
  ["RELEASED", "FINALIZE", "FINALIZED"],
];

for (const [current, evt, expected] of cases) {
  const result = nextState(current, evt);
  assert.equal(
    result,
    expected,
    `Transition ${current} --${evt}--> should resolve to ${expected}, received ${result}`,
  );
}

assert.throws(
  () => nextState("OPEN", "UNKNOWN"),
  /Unsupported transition: OPEN:UNKNOWN/,
  "Unsupported events should surface as errors",
);

assert.throws(
  () => nextState("READY_RPT", "FINALIZE"),
  /Unsupported transition: READY_RPT:FINALIZE/,
  "Transitions that skip required steps should be rejected",
);

console.log("stateMachine transitions: all assertions passed");
