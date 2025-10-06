export type Rail = "EFT" | "BPAY";

export type Destination = {
  rail: Rail;
  bsb?: string;
  account?: string;
  bpayBiller?: string;
  crn?: string;
};

export type ReleaseRequest = {
  abn: string;
  taxType: string;
  periodId: string;
  amountCents: number;
  destination: Destination;
  idemKey: string;
};

export type ReleaseResult = {
  providerRef: string;
  paidAt: Date;
  amountCents: number;
};

export interface BankingPort {
  release(request: ReleaseRequest): Promise<ReleaseResult>;
}

export type SettlementRecord = {
  providerRef: string;
  idemKey: string;
  amountCents: number;
  paidAt: Date;
  abn?: string | null;
  taxType?: string | null;
  periodId?: string | null;
  verifiedAt?: Date | null;
};

