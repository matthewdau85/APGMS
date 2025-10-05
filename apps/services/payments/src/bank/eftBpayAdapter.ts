import { createHash, randomUUID } from "crypto";
import { AdapterCallContext, AdapterMode, getAdapterMode, recordAdapterCall } from "./simulatorState.js";

export type BankTransferStatus = "OK" | "INSUFFICIENT_FUNDS" | "ERROR";

export interface SendEftOrBpayParams extends AdapterCallContext {
  abn: string;
  taxType: string;
  periodId: string;
  amount_cents: number;
  destination: { bpay_biller?: string; crn?: string; bsb?: string; acct?: string };
  idempotencyKey: string;
}

export interface BankTransferSuccess {
  status: "OK";
  transfer_uuid: string;
  provider_receipt_id: string;
  bank_receipt_hash: string;
  receipt_signature: string;
  mode: AdapterMode;
  callId: string;
}

export interface BankTransferInsufficient {
  status: "INSUFFICIENT_FUNDS";
  reason: string;
  mode: AdapterMode;
  callId: string;
}

export type BankTransferResult = BankTransferSuccess | BankTransferInsufficient;

export async function sendEftOrBpay(params: SendEftOrBpayParams): Promise<BankTransferResult> {
  const mode = getAdapterMode("bank");
  const payload = {
    amount_cents: params.amount_cents,
    destination: params.destination,
    meta: {
      abn: params.abn,
      taxType: params.taxType,
      periodId: params.periodId,
      idempotencyKey: params.idempotencyKey,
    },
  };

  if (mode === "error") {
    const callId = recordAdapterCall("bank", payload, params, { error: "Simulated bank outage" });
    throw new Error("Simulated bank outage");
  }

  if (mode === "insufficient") {
    const response: BankTransferInsufficient = {
      status: "INSUFFICIENT_FUNDS",
      reason: "Simulated account has insufficient cleared funds",
      mode,
      callId: recordAdapterCall("bank", payload, params, {
        response: { status: "INSUFFICIENT_FUNDS", reason: "Simulated account has insufficient cleared funds" },
      }),
    };
    return response;
  }

  const transfer_uuid = randomUUID();
  const provider_receipt_id = `SIM-${params.periodId}-${params.idempotencyKey.slice(0, 8)}`;
  const bank_receipt_hash = createHash("sha256").update(provider_receipt_id).digest("hex");
  const receipt_signature = createHash("sha256").update(JSON.stringify(payload)).digest("hex");

  const response: BankTransferSuccess = {
    status: "OK",
    transfer_uuid,
    provider_receipt_id,
    bank_receipt_hash,
    receipt_signature,
    mode,
    callId: "",
  };

  response.callId = recordAdapterCall("bank", payload, params, { response });
  return response;
}
