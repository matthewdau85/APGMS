import { createHash, randomUUID } from "crypto";
import {
  BankEgressPort,
  BankTransferParams,
  BankTransferResult,
  PayToDebitParams,
  PayToMandateParams
} from "@core/ports";

class MockBankEgressPort implements BankEgressPort {
  private readonly receipts = new Map<string, BankTransferResult>();

  getCapabilities(): string[] {
    return ["mock", "eft-bpay", "payto-simulated"];
  }

  async sendEftOrBpay(params: BankTransferParams): Promise<BankTransferResult> {
    const transferUuid = randomUUID();
    const providerReceiptId = `${params.abn}:${params.periodId}:${transferUuid}`;
    const bankReceiptHash = createHash("sha256").update(providerReceiptId).digest("hex");
    const result: BankTransferResult = { transferUuid, bankReceiptHash, providerReceiptId };
    this.receipts.set(params.idempotencyKey, result);
    return result;
  }

  async createMandate(params: PayToMandateParams): Promise<unknown> {
    return { id: `mandate-${params.abn}-${params.periodId}`, status: "mock-created", cap_cents: params.capCents };
  }

  async verifyMandate(mandateId: string): Promise<unknown> {
    return { id: mandateId, status: "mock-verified" };
  }

  async debitMandate(params: PayToDebitParams): Promise<unknown> {
    return { mandate_id: params.mandateId, status: "mock-debited", amount_cents: params.amountCents };
  }

  async cancelMandate(mandateId: string): Promise<unknown> {
    return { id: mandateId, status: "mock-cancelled" };
  }
}

export function createMockBankEgressPort(): BankEgressPort {
  return new MockBankEgressPort();
}
