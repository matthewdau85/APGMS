export type PeriodState = "OPEN"|"CLOSING"|"READY_RPT"|"BLOCKED_DISCREPANCY"|"BLOCKED_ANOMALY"|"RELEASED"|"FINALIZED";
export interface Thresholds { epsilon_cents: number; variance_ratio: number; dup_rate: number; gap_minutes: number; }

const transitions = new Map<string, PeriodState>([
  ["OPEN:CLOSE", "CLOSING"],
  ["CLOSING:PASS", "READY_RPT"],
  ["CLOSING:FAIL_DISCREPANCY", "BLOCKED_DISCREPANCY"],
  ["CLOSING:FAIL_ANOMALY", "BLOCKED_ANOMALY"],
  ["READY_RPT:RELEASE", "RELEASED"],
  ["RELEASED:FINALIZE", "FINALIZED"],
]);

export function nextState(current: PeriodState, evt: string): PeriodState {
  const t = `${current}:${evt}`;
  const next = transitions.get(t);
  if (!next) {
    throw new Error(`Unsupported transition: ${t}`);
  }
  return next;
}
