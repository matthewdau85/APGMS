export enum ReconState {
  OPEN = "OPEN",
  RECONCILING = "RECONCILING",
  RPT_ISSUED = "RPT_ISSUED",
  RELEASED = "RELEASED",
  BLOCKED = "BLOCKED",
}

export type ReconEvent =
  | "BEGIN_RECON"
  | "ISSUE_RPT"
  | "BLOCK"
  | "UNBLOCK"
  | "RELEASE";

type TransitionTable = {
  [K in ReconState]: ReadonlySet<ReconState>;
};

const allowedTransitions: TransitionTable = {
  [ReconState.OPEN]: new Set([ReconState.RECONCILING]),
  [ReconState.RECONCILING]: new Set([ReconState.RPT_ISSUED, ReconState.BLOCKED]),
  [ReconState.RPT_ISSUED]: new Set([ReconState.RELEASED, ReconState.BLOCKED]),
  [ReconState.RELEASED]: new Set<ReconState>(),
  [ReconState.BLOCKED]: new Set([ReconState.RECONCILING]),
};

const eventMap: Record<`${ReconState}:${ReconEvent}`, ReconState> = {
  [`${ReconState.OPEN}:BEGIN_RECON`]: ReconState.RECONCILING,
  [`${ReconState.RECONCILING}:ISSUE_RPT`]: ReconState.RPT_ISSUED,
  [`${ReconState.RECONCILING}:BLOCK`]: ReconState.BLOCKED,
  [`${ReconState.RPT_ISSUED}:RELEASE`]: ReconState.RELEASED,
  [`${ReconState.RPT_ISSUED}:BLOCK`]: ReconState.BLOCKED,
  [`${ReconState.BLOCKED}:UNBLOCK`]: ReconState.RECONCILING,
};

export function canTransition(from: ReconState, to: ReconState): boolean {
  if (from === to) return true;
  return allowedTransitions[from]?.has(to) ?? false;
}

export function assertCanTransition(from: ReconState, to: ReconState): void {
  if (!canTransition(from, to)) {
    throw new Error(`Illegal recon state transition: ${from} -> ${to}`);
  }
}

export function nextState(current: ReconState, evt: ReconEvent): ReconState {
  const key = `${current}:${evt}` as const;
  const next = eventMap[key];
  if (!next) {
    throw new Error(`Illegal recon state transition event: ${current} x ${evt}`);
  }
  assertCanTransition(current, next);
  return next;
}
