export interface BankingPort {
  eft(abn: string, amountCents: number, reference?: string): Promise<{ id: string; status: string }>;
  bpay(abn: string, crn: string, amountCents: number): Promise<{ id: string; status: string }>;
  payToSweep(mandateId: string, amountCents: number, ref: string): Promise<{ id: string; status: string }>;
}
