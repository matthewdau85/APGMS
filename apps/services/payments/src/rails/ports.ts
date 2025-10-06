export type MoneyCents = number;

export interface BaseRailRequest {
  abn: string;
  taxType: string;
  periodId: string;
  amountCents: MoneyCents;
  idempotencyKey: string;
  meta?: Record<string, unknown>;
}

export interface BpayRequest extends BaseRailRequest {
  channel: 'BPAY';
  billerCode: string;
  crn: string;
}

export interface EftRequest extends BaseRailRequest {
  channel: 'EFT';
  bsb: string;
  accountNumber: string;
  accountName?: string;
}

export interface Receipt {
  providerRef: string;
  amountCents: MoneyCents;
  channel: 'BPAY' | 'EFT';
  meta: Record<string, unknown>;
  raw: unknown;
  processedAt: Date;
}

export interface BankingPort {
  bpay(request: BpayRequest): Promise<Receipt>;
  eft(request: EftRequest): Promise<Receipt>;
}
