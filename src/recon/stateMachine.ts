export type PeriodState = "OPEN"|"CLOSING"|"READY_RPT"|"BLOCKED_DISCREPANCY"|"BLOCKED_ANOMALY"|"RELEASED"|"FINALIZED";
export interface Thresholds { epsilon_cents: number; variance_ratio: number; dup_rate: number; gap_minutes: number; }

export function nextState(current: PeriodState, evt: string): PeriodState {
  const key = `${current}:${evt}`;
  const transitions: Record<string, PeriodState> = {
    "OPEN:CLOSE": "CLOSING",
    "CLOSING:PASS": "READY_RPT",
    "CLOSING:FAIL_DISCREPANCY": "BLOCKED_DISCREPANCY",
    "CLOSING:FAIL_ANOMALY": "BLOCKED_ANOMALY",
    "BLOCKED_DISCREPANCY:REMEDIATED": "CLOSING",
    "BLOCKED_DISCREPANCY:MANUAL_OVERRIDE": "READY_RPT",
    "BLOCKED_ANOMALY:REMEDIATED": "CLOSING",
    "BLOCKED_ANOMALY:MANUAL_OVERRIDE": "READY_RPT",
    "READY_RPT:RELEASE": "RELEASED",
    "READY_RPT:RELEASED": "RELEASED",
    "READY_RPT:REVOKE": "CLOSING",
    "RELEASED:REVERSAL": "READY_RPT",
    "RELEASED:FINALIZE": "FINALIZED",
  };
  return transitions[key] ?? current;
}
