import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { nextState, PeriodState } from "../../src/recon/stateMachine";

describe("nextState", () => {
  it("follows the happy path from open to released", () => {
    let state: PeriodState = "OPEN";
    state = nextState(state, "CLOSE");
    assert.equal(state, "CLOSING");
    state = nextState(state, "PASS");
    assert.equal(state, "READY_RPT");
    state = nextState(state, "RELEASE");
    assert.equal(state, "RELEASED");
    state = nextState(state, "FINALIZE");
    assert.equal(state, "FINALIZED");
  });

  it("routes failure events into their respective blocked states", () => {
    assert.equal(nextState("CLOSING", "FAIL_DISCREPANCY"), "BLOCKED_DISCREPANCY");
    assert.equal(nextState("CLOSING", "FAIL_ANOMALY"), "BLOCKED_ANOMALY");
  });

  it("allows remediation and overrides to resume closing", () => {
    assert.equal(nextState("BLOCKED_DISCREPANCY", "REMEDIATED"), "CLOSING");
    assert.equal(nextState("BLOCKED_ANOMALY", "MANUAL_OVERRIDE"), "READY_RPT");
  });

  it("ignores unknown events", () => {
    assert.equal(nextState("READY_RPT", "UNKNOWN"), "READY_RPT");
  });
});
