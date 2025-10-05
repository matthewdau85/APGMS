import { createHash } from "crypto";
import { AdapterCallContext, AdapterMode, getAdapterMode, recordAdapterCall } from "./simulatorState.js";

export interface MandateResult {
  status: "OK" | "ERROR";
  mandate_id: string;
  mode: AdapterMode;
  callId: string;
}

export interface VerifyResult {
  status: "OK" | "ERROR";
  verified: boolean;
  mode: AdapterMode;
  callId: string;
}

export interface DebitResultSuccess {
  status: "OK";
  bank_ref: string;
  receipt_signature: string;
  mode: AdapterMode;
  callId: string;
}

export interface DebitResultInsufficient {
  status: "INSUFFICIENT_FUNDS";
  reason: string;
  mode: AdapterMode;
  callId: string;
}

export type DebitResult = DebitResultSuccess | DebitResultInsufficient;

export async function createMandate(abn: string, periodId: string, cap_cents: number, context?: AdapterCallContext): Promise<MandateResult> {
  const mode = getAdapterMode("payto");
  const payload = { abn, periodId, cap_cents };
  if (mode === "error") {
    recordAdapterCall("payto", payload, context, { error: "Simulated PayTo outage" });
    throw new Error("Simulated PayTo outage");
  }
  const response: MandateResult = {
    status: "OK",
    mandate_id: `SIM-M-${periodId}`,
    mode,
    callId: recordAdapterCall("payto", payload, context, { response: { status: "OK" } }),
  };
  return response;
}

export async function verifyMandate(mandate_id: string, context?: AdapterCallContext): Promise<VerifyResult> {
  const mode = getAdapterMode("payto");
  const payload = { mandate_id };
  if (mode === "error") {
    recordAdapterCall("payto", payload, context, { error: "Simulated PayTo verification outage" });
    throw new Error("Simulated PayTo verification outage");
  }
  const response: VerifyResult = {
    status: "OK",
    verified: true,
    mode,
    callId: recordAdapterCall("payto", payload, context, { response: { status: "OK", verified: true } }),
  };
  return response;
}

export async function debitMandate(
  mandate_id: string,
  amount_cents: number,
  meta: AdapterCallContext & { reference?: string; sources?: Array<{ basLabel?: string; amount_cents?: number; reference?: string; channel?: string; description?: string }> }
): Promise<DebitResult> {
  const mode = getAdapterMode("payto");
  const payload = { mandate_id, amount_cents, meta };

  if (mode === "error") {
    recordAdapterCall("payto", payload, meta, { error: "Simulated PayTo debit failure" });
    throw new Error("Simulated PayTo debit failure");
  }

  if (mode === "insufficient") {
    const response: DebitResultInsufficient = {
      status: "INSUFFICIENT_FUNDS",
      reason: "Simulated PayTo mandate cap reached",
      mode,
      callId: recordAdapterCall("payto", payload, meta, {
        response: { status: "INSUFFICIENT_FUNDS", reason: "Simulated PayTo mandate cap reached" },
      }),
    };
    return response;
  }

  const bank_ref = `PAYTO-${mandate_id.slice(0, 8)}-${String(amount_cents).padStart(6, "0")}`;
  const receipt_signature = createHash("sha256").update(JSON.stringify({ mandate_id, amount_cents, meta })).digest("hex");
  const response: DebitResultSuccess = {
    status: "OK",
    bank_ref,
    receipt_signature,
    mode,
    callId: recordAdapterCall("payto", payload, meta, { response: { status: "OK", bank_ref, receipt_signature } }),
  };
  return response;
}

export async function cancelMandate(mandate_id: string, context?: AdapterCallContext) {
  const mode = getAdapterMode("payto");
  const payload = { mandate_id };
  if (mode === "error") {
    recordAdapterCall("payto", payload, context, { error: "Simulated PayTo cancel outage" });
    throw new Error("Simulated PayTo cancel outage");
  }
  return {
    status: "OK",
    mode,
    callId: recordAdapterCall("payto", payload, context, { response: { status: "OK" } }),
  };
}
