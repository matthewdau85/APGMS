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
  delta_vs_baseline?: number;
}

const transitionMap = new Map<string, PeriodState>([
  ["OPEN:CLOSE", "CLOSING"],
  ["OPEN:BLOCK_DISCREPANCY", "BLOCKED_DISCREPANCY"],
  ["OPEN:BLOCK_ANOMALY", "BLOCKED_ANOMALY"],
  ["CLOSING:PASS", "READY_RPT"],
  ["CLOSING:FAIL_DISCREPANCY", "BLOCKED_DISCREPANCY"],
  ["CLOSING:FAIL_ANOMALY", "BLOCKED_ANOMALY"],
  ["BLOCKED_DISCREPANCY:REMEDIED", "CLOSING"],
  ["BLOCKED_DISCREPANCY:RESET", "OPEN"],
  ["BLOCKED_ANOMALY:REMEDIED", "CLOSING"],
  ["BLOCKED_ANOMALY:RESET", "OPEN"],
  ["READY_RPT:RELEASE", "RELEASED"],
  ["READY_RPT:BLOCK_DISCREPANCY", "BLOCKED_DISCREPANCY"],
  ["READY_RPT:BLOCK_ANOMALY", "BLOCKED_ANOMALY"],
  ["READY_RPT:RESET", "OPEN"],
  ["RELEASED:FINALIZE", "FINALIZED"],
]);

export function nextState(current: PeriodState, evt: string): PeriodState {
  const t = `${current}:${evt}`;
  return transitionMap.get(t) ?? current;
}
