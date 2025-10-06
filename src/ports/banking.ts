export interface BankingPort {
  eft(p: {
    bsb: string;
    account: string;
    name: string;
    amountCents: number;
    idemKey: string;
  }): Promise<{
    providerRef: string;
    paidAt: string;
    channel: "EFT";
    simulated: boolean;
  }>;

  bpay(p: {
    billerCode: string;
    crn: string;
    amountCents: number;
    idemKey: string;
  }): Promise<{
    providerRef: string;
    paidAt: string;
    channel: "BPAY";
    simulated: boolean;
  }>;

  payToSweep(p: {
    mandateId: string;
    amountCents: number;
    idemKey: string;
  }): Promise<{
    providerRef: string;
    paidAt: string;
    channel: "PayTo";
    simulated: boolean;
  }>;
}
