import { AdapterCallOptions } from "./adapterTypes";

export async function transferToOneWayAccount(
  amount: number,
  from: string,
  to: string,
  opts: AdapterCallOptions
) {
  const payload = { amount, from, to };
  if (opts.mode === "error") {
    const error = "Simulated bank adapter outage";
    opts.log("bank", opts.mode, payload, { error });
    throw new Error(error);
  }
  if (opts.mode === "insufficient") {
    const response = { status: "INSUFFICIENT_FUNDS", reason: "Simulated source account empty" };
    opts.log("bank", opts.mode, payload, { response });
    return response;
  }
  const response = {
    status: "OK",
    signature: `SIGNED-${amount}-${to}-${Date.now()}`,
  };
  opts.log("bank", opts.mode, payload, { response });
  return response;
}

export async function verifyFunds(paygwDue: number, gstDue: number, opts: AdapterCallOptions) {
  const payload = { paygwDue, gstDue };
  if (opts.mode === "error") {
    const error = "Simulated balance verification failure";
    opts.log("bank", opts.mode, payload, { error });
    throw new Error(error);
  }
  if (opts.mode === "insufficient") {
    const response = { status: "INSUFFICIENT_FUNDS", available: 0 };
    opts.log("bank", opts.mode, payload, { response });
    return response;
  }
  const response = { status: "OK", available: paygwDue + gstDue };
  opts.log("bank", opts.mode, payload, { response });
  return response;
}

export async function initiateTransfer(paygwDue: number, gstDue: number, opts: AdapterCallOptions) {
  const payload = { paygwDue, gstDue };
  if (opts.mode === "error") {
    const error = "Simulated transfer gateway outage";
    opts.log("bank", opts.mode, payload, { error });
    throw new Error(error);
  }
  if (opts.mode === "insufficient") {
    const response = { status: "INSUFFICIENT_FUNDS", reason: "Mandate limit exceeded" };
    opts.log("bank", opts.mode, payload, { response });
    return response;
  }
  const response = { status: "OK", receipt: `ATO-${Date.now()}` };
  opts.log("bank", opts.mode, payload, { response });
  return response;
}
