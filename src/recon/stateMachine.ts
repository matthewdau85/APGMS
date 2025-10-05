type State = "OPEN" | "RECONCILING" | "CLOSED_OK" | "CLOSED_FAIL";
type Evt = "BEGIN_RECON" | "RECON_OK" | "RECON_FAIL";

const table: Record<string, State> = {
  "OPEN:BEGIN_RECON": "RECONCILING",
  "RECONCILING:RECON_OK": "CLOSED_OK",
  "RECONCILING:RECON_FAIL": "CLOSED_FAIL",
};

export function nextState(current: State, evt: Evt): State {
  const key = `${current}:${evt}`;
  const next = table[key];
  if (!next) throw new Error(`invalid transition ${key}`);
  return next;
}
