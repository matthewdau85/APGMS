declare module "../../libs/paymentsClient" {
  type CommonArgs = {
    abn: string;
    taxType: string;
    periodId: string;
  };

  export type DepositArgs = CommonArgs & { amountCents: number };
  export type ReleaseArgs = CommonArgs & { amountCents: number };

  export const Payments: {
    deposit(args: DepositArgs): Promise<any>;
    payAto(args: ReleaseArgs): Promise<any>;
    balance(q: CommonArgs): Promise<any>;
    ledger(q: CommonArgs): Promise<any>;
  };
}
