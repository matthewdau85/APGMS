export type PeriodState =
  | "OPEN"
  | "CLOSING"
  | "READY_RPT"
  | "BLOCKED_DISCREPANCY"
  | "BLOCKED_ANOMALY"
  | "RELEASED"
  | "FINALIZED";

const transitions: Record<string, PeriodState> = {
  "OPEN:CLOSE": "CLOSING",
  "CLOSING:PASS": "READY_RPT",
  "CLOSING:FAIL_DISCREPANCY": "BLOCKED_DISCREPANCY",
  "CLOSING:FAIL_ANOMALY": "BLOCKED_ANOMALY",
  "BLOCKED_DISCREPANCY:RETRY": "CLOSING",
  "BLOCKED_ANOMALY:RETRY": "CLOSING",
  "READY_RPT:RELEASE": "RELEASED",
  "RELEASED:FINALIZE": "FINALIZED",
};

export function nextState(current: PeriodState, evt: string): PeriodState {
  const key = `${current}:${evt}`;
  const next = transitions[key];
  if (!next) {
    throw new Error(`INVALID_TRANSITION:${key}`);
  }
  return next;
}
