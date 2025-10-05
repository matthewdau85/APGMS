export type Tx = {
  id: string;
  abn: string;
  amountCents: number;
  channel: "EFT" | "BPAY" | "PayTo";
  reference?: string;
  status: "PENDING" | "SETTLED" | "FAILED";
};

export interface BankingPort {
  eft(abn: string, amountCents: number, reference?: string): Promise<Tx>;
  bpay(abn: string, amountCents: number, reference?: string): Promise<Tx>;
  payToSweep(mandateId: string, amountCents: number, ref: string): Promise<Tx>;
}
