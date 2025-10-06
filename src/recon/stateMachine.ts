export type PeriodState =
  | "OPEN"
  | "CLOSING"
  | "RECON_OK"
  | "RECON_FAIL"
  | "READY_RPT"
  | "RELEASED";

export type PeriodEvent =
  | "START_CLOSING"
  | "RECONCILE_OK"
  | "RECONCILE_FAIL"
  | "ISSUE_RPT"
  | "RELEASE";

const transitions: Record<PeriodState, Partial<Record<PeriodEvent, PeriodState>>> = {
  OPEN: { START_CLOSING: "CLOSING" },
  CLOSING: { RECONCILE_OK: "RECON_OK", RECONCILE_FAIL: "RECON_FAIL" },
  RECON_OK: { ISSUE_RPT: "READY_RPT", RECONCILE_FAIL: "RECON_FAIL" },
  RECON_FAIL: { RECONCILE_OK: "RECON_OK" },
  READY_RPT: { RELEASE: "RELEASED" },
  RELEASED: {},
};

export function next(current: PeriodState, event: PeriodEvent): PeriodState {
  return transitions[current]?.[event] ?? current;
}
