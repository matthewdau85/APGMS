export type PeriodState =
  | "OPEN"
  | "CLOSING"
  | "READY_RPT"
  | "BLOCKED_DISCREPANCY"
  | "BLOCKED_ANOMALY"
  | "RELEASED"
  | "CLOSED_OK"
  | "CLOSED_FAIL";

export interface Thresholds {
  epsilon_cents: number;
  variance_ratio: number;
  dup_rate: number;
  gap_minutes: number;
}

const transitions: Record<PeriodState, Readonly<Record<string, PeriodState>>> = {
  OPEN: { CLOSE: "CLOSING" },
  CLOSING: {
    PASS: "READY_RPT",
    FAIL_DISCREPANCY: "BLOCKED_DISCREPANCY",
    FAIL_ANOMALY: "BLOCKED_ANOMALY",
  },
  READY_RPT: {
    RELEASE: "RELEASED",
    ABORT: "CLOSED_FAIL",
  },
  BLOCKED_DISCREPANCY: {
    CLOSE: "CLOSED_FAIL",
  },
  BLOCKED_ANOMALY: {
    CLOSE: "CLOSED_FAIL",
  },
  RELEASED: {
    FINALIZE_OK: "CLOSED_OK",
    FINALIZE_FAIL: "CLOSED_FAIL",
  },
  CLOSED_OK: {},
  CLOSED_FAIL: {},
};

export function nextState(current: PeriodState, evt: string): PeriodState {
  const stateTransitions = transitions[current];

  if (!stateTransitions) {
    throw new Error(`UNKNOWN_STATE:${current}`);
  }

  const next = stateTransitions[evt];

  if (!next) {
    throw new Error(`INVALID_TRANSITION:${current}:${evt}`);
  }

  return next;
}
