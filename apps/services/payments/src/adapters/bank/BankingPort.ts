export type EftOptions = {
  amount_cents: number;
  bsb: string;
  account: string;
  reference: string;
  idempotencyKey: string;
};

export type BpayOptions = {
  amount_cents: number;
  biller_code: string;
  crn: string;
  reference: string;
  idempotencyKey: string;
};

export type BankingResult = {
  provider_ref: string;
  paid_at: string;
};

export interface BankingPort {
  eft(opts: EftOptions): Promise<BankingResult>;
  bpay(opts: BpayOptions): Promise<BankingResult>;
}
