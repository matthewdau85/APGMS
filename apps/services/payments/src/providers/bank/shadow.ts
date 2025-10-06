import {
  BankEgressPort,
  BankTransferParams,
  BankTransferResult,
  PayToDebitParams,
  PayToMandateParams
} from "@core/ports";
import { createMockBankEgressPort } from "./mock";
import { createRealBankEgressPort } from "./real";

class ShadowBankEgressPort implements BankEgressPort {
  private readonly real: BankEgressPort;
  private readonly mock: BankEgressPort;

  constructor(real: BankEgressPort, mock: BankEgressPort) {
    this.real = real;
    this.mock = mock;
  }

  getCapabilities(): string[] {
    const realCaps = this.real.getCapabilities?.() ?? [];
    return ["shadow", ...realCaps];
  }

  async sendEftOrBpay(params: BankTransferParams): Promise<BankTransferResult> {
    try {
      console.warn("[bank-shadow] forwarding EFT/BPAY to real provider", {
        abn: params.abn,
        taxType: params.taxType,
        periodId: params.periodId
      });
      return await this.real.sendEftOrBpay(params);
    } catch (error) {
      console.warn("[bank-shadow] real provider failed, falling back to mock", error);
      return this.mock.sendEftOrBpay(params);
    }
  }

  async createMandate(params: PayToMandateParams): Promise<unknown> {
    try {
      return await this.real.createMandate?.(params);
    } catch (error) {
      console.warn("[bank-shadow] createMandate fallback", error);
      return this.mock.createMandate?.(params);
    }
  }

  async verifyMandate(mandateId: string): Promise<unknown> {
    try {
      return await this.real.verifyMandate?.(mandateId);
    } catch (error) {
      console.warn("[bank-shadow] verifyMandate fallback", error);
      return this.mock.verifyMandate?.(mandateId);
    }
  }

  async debitMandate(params: PayToDebitParams): Promise<unknown> {
    try {
      return await this.real.debitMandate?.(params);
    } catch (error) {
      console.warn("[bank-shadow] debitMandate fallback", error);
      return this.mock.debitMandate?.(params);
    }
  }

  async cancelMandate(mandateId: string): Promise<unknown> {
    try {
      return await this.real.cancelMandate?.(mandateId);
    } catch (error) {
      console.warn("[bank-shadow] cancelMandate fallback", error);
      return this.mock.cancelMandate?.(mandateId);
    }
  }
}

export function createShadowBankEgressPort(): BankEgressPort {
  const mock = createMockBankEgressPort();
  let real: BankEgressPort;
  try {
    real = createRealBankEgressPort();
  } catch (error) {
    console.warn("[bank-shadow] real provider unavailable during init", error);
    real = mock;
  }
  return new ShadowBankEgressPort(real, mock);
}
