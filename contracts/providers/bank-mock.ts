import type { BankPort, BankTransferRequest, BankTransferResponse } from "../interfaces";
import { makeError, makeIdempotencyKey, isoNow } from "./shared";

export async function createProvider(): Promise<BankPort> {
  const ledger = new Map<string, BankTransferResponse>();
  return {
    timeoutMs: 4500,
    retriableCodes: ["BANK_TEMPORARY", "HTTP_429"],
    async initiateTransfer(request: BankTransferRequest): Promise<BankTransferResponse> {
      const key = makeIdempotencyKey([request.abn, request.amountCents, request.reference]);
      const existing = ledger.get(key);
      if (existing) {
        return existing;
      }
      const response: BankTransferResponse = {
        transferId: `mock-${key.slice(0, 12)}`,
        status: request.amountCents >= 0 ? "ACCEPTED" : "REJECTED",
        receipt: {
          provider: "bank-mock",
          issuedAt: isoNow(),
          reference: request.reference,
        },
      };
      ledger.set(key, response);
      return response;
    },
    idempotencyKey(request: BankTransferRequest): string {
      return makeIdempotencyKey([request.abn, request.amountCents, request.reference]);
    },
    async simulateError(kind) {
      switch (kind) {
        case "insufficient_funds":
          return makeError("INSUFFICIENT_FUNDS", "Account balance too low", false, 402);
        case "timeout":
          return makeError("BANK_TIMEOUT", "Bank gateway timeout", true, 504);
        case "network":
        default:
          return makeError("BANK_NETWORK", "Transient connectivity issue", true, 503);
      }
    },
  };
}

export default createProvider;
