import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PeriodState, nextState } from "../../src/recon/stateMachine";

describe("recon state machine", () => {
  it("supports the happy path from open to finalized", () => {
    const closing = nextState("OPEN", "CLOSE");
    assert.equal(closing, "CLOSING");

    const ready = nextState(closing, "PASS");
    assert.equal(ready, "READY_RPT");

    const released = nextState(ready, "RELEASE");
    assert.equal(released, "RELEASED");

    const finalized = nextState(released, "FINALIZE");
    assert.equal(finalized, "FINALIZED");
  });

  it("routes blocking events back through closing once resolved", () => {
    const blocked = nextState("CLOSING", "FAIL_ANOMALY");
    assert.equal(blocked, "BLOCKED_ANOMALY");

    const retried = nextState(blocked, "RETRY");
    assert.equal(retried, "CLOSING");

    const blockedDiscrepancy = nextState("CLOSING", "FAIL_DISCREPANCY");
    assert.equal(blockedDiscrepancy, "BLOCKED_DISCREPANCY");

    const reconciled = nextState(blockedDiscrepancy, "RECONCILED");
    assert.equal(reconciled, "CLOSING");
  });

  it("is idempotent for unsupported transitions", () => {
    const state: PeriodState = "READY_RPT";
    assert.equal(nextState(state, "UNKNOWN"), state);
  });
});
