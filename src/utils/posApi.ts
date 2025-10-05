import { AdapterCallOptions } from "./adapterTypes";

export async function submitSale(payload: any, opts: AdapterCallOptions) {
  const meta = { type: "POS", payload };
  if (opts.mode === "error") {
    const error = "Simulated POS API outage";
    opts.log("pos", opts.mode, meta, { error });
    throw new Error(error);
  }
  if (opts.mode === "insufficient") {
    const response = { status: "REJECTED", reason: "Duplicate sale detected" };
    opts.log("pos", opts.mode, meta, { response });
    return response;
  }
  const response = { status: "OK", receipt: `POS-${Date.now()}` };
  opts.log("pos", opts.mode, meta, { response });
  return response;
}
