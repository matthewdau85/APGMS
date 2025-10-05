export const PeriodStates = {
  OPEN: "OPEN",
  CLOSING: "CLOSING",
  READY_RPT: "READY_RPT",
  BLOCKED_DISCREPANCY: "BLOCKED_DISCREPANCY",
  BLOCKED_ANOMALY: "BLOCKED_ANOMALY",
  RELEASED: "RELEASED",
  FINALIZED: "FINALIZED",
} as const;

export type PeriodState = typeof PeriodStates[keyof typeof PeriodStates];

export const PeriodEvents = {
  CLOSE: "CLOSE",
  PASS: "PASS",
  FAIL_DISCREPANCY: "FAIL_DISCREPANCY",
  FAIL_ANOMALY: "FAIL_ANOMALY",
  RESOLVE_DISCREPANCY: "RESOLVE_DISCREPANCY",
  RESOLVE_ANOMALY: "RESOLVE_ANOMALY",
  RELEASE: "RELEASE",
  FINALIZE: "FINALIZE",
} as const;

export type PeriodEvent = typeof PeriodEvents[keyof typeof PeriodEvents];

export interface Thresholds {
  epsilon_cents: number;
  variance_ratio: number;
  dup_rate: number;
  gap_minutes: number;
}

type TransitionMap = {
  [S in PeriodState]: Partial<Record<PeriodEvent, PeriodState>>;
};

export const periodTransitionMap = {
  [PeriodStates.OPEN]: {
    [PeriodEvents.CLOSE]: PeriodStates.CLOSING,
  },
  [PeriodStates.CLOSING]: {
    [PeriodEvents.PASS]: PeriodStates.READY_RPT,
    [PeriodEvents.FAIL_DISCREPANCY]: PeriodStates.BLOCKED_DISCREPANCY,
    [PeriodEvents.FAIL_ANOMALY]: PeriodStates.BLOCKED_ANOMALY,
  },
  [PeriodStates.BLOCKED_DISCREPANCY]: {
    [PeriodEvents.RESOLVE_DISCREPANCY]: PeriodStates.CLOSING,
  },
  [PeriodStates.BLOCKED_ANOMALY]: {
    [PeriodEvents.RESOLVE_ANOMALY]: PeriodStates.CLOSING,
  },
  [PeriodStates.READY_RPT]: {
    [PeriodEvents.RELEASE]: PeriodStates.RELEASED,
  },
  [PeriodStates.RELEASED]: {
    [PeriodEvents.FINALIZE]: PeriodStates.FINALIZED,
  },
  [PeriodStates.FINALIZED]: {},
} satisfies TransitionMap;

export function nextState(current: PeriodState, evt: PeriodEvent): PeriodState {
  const next = periodTransitionMap[current]?.[evt];
  if (!next) {
    throw new Error(`Invalid transition: ${current} -> ${evt}`);
  }
  return next;
}
