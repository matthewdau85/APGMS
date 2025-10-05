import assert from "node:assert/strict";
import test from "node:test";

import {
  nextState,
  PeriodEvents,
  PeriodStates,
  PeriodState,
  PeriodEvent,
} from "../src/recon/stateMachine";

test("BAS gate happy path transitions", () => {
  let state: PeriodState = PeriodStates.OPEN;
  state = nextState(state, PeriodEvents.CLOSE);
  assert.equal(state, PeriodStates.CLOSING);

  state = nextState(state, PeriodEvents.PASS);
  assert.equal(state, PeriodStates.READY_RPT);

  state = nextState(state, PeriodEvents.RELEASE);
  assert.equal(state, PeriodStates.RELEASED);

  state = nextState(state, PeriodEvents.FINALIZE);
  assert.equal(state, PeriodStates.FINALIZED);
});

test("blocked discrepancy must be resolved before continuing", () => {
  let state: PeriodState = PeriodStates.CLOSING;
  state = nextState(state, PeriodEvents.FAIL_DISCREPANCY);
  assert.equal(state, PeriodStates.BLOCKED_DISCREPANCY);

  state = nextState(state, PeriodEvents.RESOLVE_DISCREPANCY);
  assert.equal(state, PeriodStates.CLOSING);
});

test("blocked anomaly requires resolution", () => {
  let state: PeriodState = PeriodStates.CLOSING;
  state = nextState(state, PeriodEvents.FAIL_ANOMALY);
  assert.equal(state, PeriodStates.BLOCKED_ANOMALY);

  state = nextState(state, PeriodEvents.RESOLVE_ANOMALY);
  assert.equal(state, PeriodStates.CLOSING);
});

test("invalid transitions throw", () => {
  assert.throws(() => nextState(PeriodStates.OPEN, PeriodEvents.PASS));
  assert.throws(() => nextState(PeriodStates.FINALIZED, PeriodEvents.CLOSE));
  assert.throws(() => nextState(PeriodStates.CLOSING, "UNKNOWN" as PeriodEvent));
});
