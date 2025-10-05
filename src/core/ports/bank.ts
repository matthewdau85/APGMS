export type BankRail = "EFT" | "BPAY";

export interface BankDestination {
  abn: string;
  rail: BankRail;
  reference: string;
  account_name: string;
  account_number: string;
  bsb: string;
}

export interface BankReleaseResult {
  transfer_uuid: string;
  bank_receipt_hash: string;
  status?: "OK" | "DUPLICATE";
}

export class BankProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BankProviderError";
  }
}

export interface BankEgressProvider {
  resolveDestination(abn: string, rail: BankRail, reference: string): Promise<BankDestination>;
  releasePayment(
    abn: string,
    taxType: string,
    periodId: string,
    amountCents: number,
    rail: BankRail,
    reference: string
  ): Promise<BankReleaseResult>;
}
