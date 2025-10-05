export type BankEftDestination = {
  bpay_biller?: string;
  crn?: string;
  bsb?: string;
  acct?: string;
};

export type BankTransferParams = {
  abn: string;
  taxType: string;
  periodId: string;
  amountCents: number;
  destination: BankEftDestination;
  idempotencyKey: string;
};

export type BankTransferResult = {
  transferUuid: string;
  bankReceiptHash: string;
  providerReceiptId: string;
};

export type PayToMandateParams = {
  abn: string;
  periodId: string;
  capCents: number;
};

export type PayToDebitParams = {
  mandateId: string;
  amountCents: number;
  metadata: Record<string, unknown>;
};

export interface BankEgressPort {
  /** Optional capability descriptor for diagnostics. */
  getCapabilities?(): string[];

  /** Initiate an outbound EFT/BPAY payment. */
  sendEftOrBpay(params: BankTransferParams): Promise<BankTransferResult>;

  /** PAYTO mandate lifecycle helpers (optional for some providers). */
  createMandate?(params: PayToMandateParams): Promise<unknown>;
  verifyMandate?(mandateId: string): Promise<unknown>;
  debitMandate?(params: PayToDebitParams): Promise<unknown>;
  cancelMandate?(mandateId: string): Promise<unknown>;
}
