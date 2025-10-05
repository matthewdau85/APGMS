export type PeriodState = "OPEN"|"CLOSING"|"READY_RPT"|"BLOCKED_DISCREPANCY"|"BLOCKED_ANOMALY"|"RELEASED"|"FINALIZED";
export interface Thresholds { epsilon_cents: number; variance_ratio: number; dup_rate: number; gap_minutes: number; }

export function nextState(current: PeriodState, evt: string): PeriodState {
  const t = ${current}:;
  switch (t) {
    case "OPEN:CLOSE": return "CLOSING";
    case "CLOSING:PASS": return "READY_RPT";
    case "CLOSING:FAIL_DISCREPANCY": return "BLOCKED_DISCREPANCY";
    case "CLOSING:FAIL_ANOMALY": return "BLOCKED_ANOMALY";
    case "READY_RPT:RELEASED": return "RELEASED";
    case "RELEASED:FINALIZE": return "FINALIZED";
    default: return current;
  }
}
