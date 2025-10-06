import { mockBankingPort } from "./adapters/mockBanking.js";
import { realBankingPort } from "./adapters/realBanking.js";

export type BankingChannel = "EFT" | "BPAY" | "PAYTO";

export type BankingBaseRequest = {
  abn: string;
  taxType: string;
  periodId: string;
  amountCents: number;
  transferUuid: string;
  idempotencyKey: string;
};

export type EftRequest = BankingBaseRequest & {
  bsb: string;
  accountNumber: string;
  lodgementReference: string;
};

export type BpayRequest = BankingBaseRequest & {
  billerCode: string;
  crn: string;
};

export type PayToSweepRequest = BankingBaseRequest & {
  sweepId: string;
};

export type BankingResult = {
  providerRef: string;
  transferUuid: string;
};

export interface BankingPort {
  eft(request: EftRequest): Promise<BankingResult>;
  bpay(request: BpayRequest): Promise<BankingResult>;
  payToSweep(request: PayToSweepRequest): Promise<BankingResult>;
}

export function getBankingPort(): BankingPort {
  const adapter = (process.env.BANKING_ADAPTER ?? "mock").toLowerCase();
  if (adapter === "real") {
    return realBankingPort;
  }
  return mockBankingPort;
}
