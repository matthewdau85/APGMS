import { AdapterCallOptions } from "./adapterTypes";

export async function submitStpEvent(payload: any, opts: AdapterCallOptions) {
  const meta = { type: "STP", payload };
  if (opts.mode === "error") {
    const error = "Simulated STP gateway outage";
    opts.log("payroll", opts.mode, meta, { error });
    throw new Error(error);
  }
  if (opts.mode === "insufficient") {
    const response = { status: "REJECTED", reason: "ATO validation failed" };
    opts.log("payroll", opts.mode, meta, { response });
    return response;
  }
  const response = { status: "OK", submission_reference: `STP-${Date.now()}` };
  opts.log("payroll", opts.mode, meta, { response });
  return response;
}
