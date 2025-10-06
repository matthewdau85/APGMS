export type PeriodState =
  | "OPEN"
  | "CLOSING"
  | "READY_RPT"
  | "BLOCKED_DISCREPANCY"
  | "BLOCKED_ANOMALY"
  | "RELEASED"
  | "FINALIZED";

export type GateEvent =
  | "CLOSE"
  | "PASS"
  | "FAIL_DISCREPANCY"
  | "FAIL_ANOMALY"
  | "UNBLOCK"
  | "RELEASE"
  | "FINALIZE";

export interface Thresholds {
  epsilon_cents: number;
  variance_ratio: number;
  dup_rate: number;
  gap_minutes: number;
  delta_vs_baseline?: number;
}

/**
 * Compute the next BAS gate state given the current state and a transition event.
 * The implementation intentionally mirrors the state machine defined in the
 * patent artefacts so the recon tests can assert on the same language used by
 * the ops playbooks.
 */
export function nextState(current: PeriodState, event: GateEvent): PeriodState {
  switch (current) {
    case "OPEN":
      return event === "CLOSE" ? "CLOSING" : current;
    case "CLOSING":
      if (event === "PASS") return "READY_RPT";
      if (event === "FAIL_DISCREPANCY") return "BLOCKED_DISCREPANCY";
      if (event === "FAIL_ANOMALY") return "BLOCKED_ANOMALY";
      return current;
    case "BLOCKED_DISCREPANCY":
    case "BLOCKED_ANOMALY":
      return event === "UNBLOCK" ? "CLOSING" : current;
    case "READY_RPT":
      return event === "RELEASE" ? "RELEASED" : current;
    case "RELEASED":
      return event === "FINALIZE" ? "FINALIZED" : current;
    case "FINALIZED":
    default:
      return current;
  }
}
