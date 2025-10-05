import { BankApiError, bankClient } from "../utils/secureBankClient";

export type PayToMandateStatus = "PENDING" | "ACTIVE" | "SUSPENDED" | "CANCELLED";

export interface PayToMandate {
  mandateId: string;
  status: PayToMandateStatus;
  capCents: number;
  reference: string;
  debtorAbn: string;
  createdAt: string;
  updatedAt: string;
  bankReference?: string;
}

export interface PayToCreateMandateResult {
  status: "OK";
  mandate: PayToMandate;
}

export interface PayToDebitParams {
  abn: string;
  mandateId: string;
  amountCents: number;
  reference: string;
}

export interface PayToDebitResult {
  status: "OK" | "INSUFFICIENT_FUNDS" | "BANK_ERROR";
  bank_ref?: string;
  code?: string;
  message?: string;
}

function mapMandate(payload: any): PayToMandate {
  return {
    mandateId: payload?.mandate_id ?? payload?.id,
    status: (payload?.status || "PENDING") as PayToMandateStatus,
    capCents: Number(payload?.cap_cents ?? payload?.capCents ?? 0),
    reference: payload?.reference ?? payload?.customer_reference ?? "",
    debtorAbn: payload?.abn ?? payload?.debtor_abn ?? "",
    createdAt: payload?.created_at ?? new Date().toISOString(),
    updatedAt: payload?.updated_at ?? payload?.created_at ?? new Date().toISOString(),
    bankReference: payload?.bank_reference ?? payload?.npp_reference,
  };
}

const insufficientCodes = new Set([
  "INSUFFICIENT_FUNDS",
  "PAYMENT_REFUSED_INSUFFICIENT_FUNDS",
  "RTP_0500",
]);

export async function createMandate(abn: string, capCents: number, reference: string): Promise<PayToCreateMandateResult> {
  if (!abn) throw new Error("ABN is required to create a PayTo mandate");
  if (!Number.isFinite(capCents) || capCents <= 0) throw new Error("capCents must be a positive integer");
  if (!reference) throw new Error("reference is required");

  const payload = await bankClient.createPayToMandate({ abn, capCents, reference });
  const mandate = mapMandate(payload);
  if (!mandate.mandateId) {
    throw new Error("Bank API did not return a mandate identifier");
  }
  return { status: "OK", mandate };
}

export async function debit(params: PayToDebitParams): Promise<PayToDebitResult> {
  const { abn, mandateId, amountCents, reference } = params;
  if (!mandateId) throw new Error("mandateId is required for PayTo debit");
  if (!Number.isFinite(amountCents) || amountCents <= 0) {
    throw new Error("amountCents must be a positive integer");
  }
  try {
    const payload = await bankClient.debitPayToMandate({
      mandateId,
      amountCents,
      debtorAbn: abn,
      reference,
    });
    const bankRef = payload?.bank_reference ?? payload?.receipt_id ?? reference;
    return { status: "OK", bank_ref: bankRef };
  } catch (err: any) {
    if (err instanceof BankApiError) {
      const code = err.code || err.details?.code || err.details?.reason;
      const bankRef = err.details?.bank_reference ?? err.details?.receipt_id;
      if (code && insufficientCodes.has(String(code))) {
        return { status: "INSUFFICIENT_FUNDS", bank_ref: bankRef, code, message: err.message };
      }
      return { status: "BANK_ERROR", bank_ref: bankRef, code, message: err.message };
    }
    throw err;
  }
}

export async function cancelMandate(mandateId: string) {
  if (!mandateId) throw new Error("mandateId is required to cancel a PayTo mandate");
  await bankClient.cancelPayToMandate(mandateId);
  return { status: "OK" };
}
