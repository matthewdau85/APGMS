export type PeriodState =
  | "OPEN"
  | "CLOSING"
  | "READY_RPT"
  | "BLOCKED_DISCREPANCY"
  | "BLOCKED_ANOMALY"
  | "RELEASED"
  | "FINALIZED";

export interface Thresholds {
  epsilon_cents: number;
  variance_ratio: number;
  dup_rate: number;
  gap_minutes: number;
}

const transitions: Record<string, PeriodState> = {
  "OPEN:CLOSE": "CLOSING",
  "CLOSING:PASS": "READY_RPT",
  "CLOSING:FAIL_DISCREPANCY": "BLOCKED_DISCREPANCY",
  "CLOSING:FAIL_ANOMALY": "BLOCKED_ANOMALY",
  "BLOCKED_DISCREPANCY:RESET": "CLOSING",
  "BLOCKED_DISCREPANCY:OVERRIDE": "READY_RPT",
  "BLOCKED_ANOMALY:RESET": "CLOSING",
  "BLOCKED_ANOMALY:OVERRIDE": "READY_RPT",
  "READY_RPT:RELEASE": "RELEASED",
  "READY_RPT:RESET": "CLOSING",
  "READY_RPT:BLOCK_DISCREPANCY": "BLOCKED_DISCREPANCY",
  "READY_RPT:BLOCK_ANOMALY": "BLOCKED_ANOMALY",
  "RELEASED:FINALIZE": "FINALIZED",
  "RELEASED:REOPEN": "CLOSING",
};

export function nextState(current: PeriodState, evt: string): PeriodState {
  const key = `${current}:${evt.toUpperCase()}`;
  return transitions[key] ?? current;
}
