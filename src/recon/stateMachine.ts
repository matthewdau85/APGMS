export type PeriodState = "OPEN" | "CLOSING" | "READY_RPT" | "BLOCKED" | "RELEASED" | "FINALIZED";
export type ReconEvent = "START_CLOSING" | "RECON_OK" | "RECON_FAIL" | "RELEASE" | "FINALISE";

export function nextState(current: PeriodState, evt: ReconEvent): PeriodState {
  switch (current) {
    case "OPEN":
      return evt === "START_CLOSING" ? "CLOSING" : current;
    case "CLOSING":
      if (evt === "RECON_OK") return "READY_RPT";
      if (evt === "RECON_FAIL") return "BLOCKED";
      return current;
    case "BLOCKED":
      if (evt === "RECON_OK") return "READY_RPT";
      return current;
    case "READY_RPT":
      if (evt === "RELEASE") return "RELEASED";
      return current;
    case "RELEASED":
      if (evt === "FINALISE") return "FINALIZED";
      return current;
    default:
      return current;
  }
}
