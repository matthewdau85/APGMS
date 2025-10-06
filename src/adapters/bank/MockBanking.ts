import { createHash, randomUUID } from "crypto";
import { BankingPort } from ".";
import { BankingResponse } from "./MtlsBanking";

type EftArgs = { abn: string; bsb: string; acct: string; amountCents: number; idemKey?: string };
type BpayArgs = { abn: string; crn: string; amountCents: number; idemKey?: string };

export class MockBanking implements BankingPort {
  async eft(args: EftArgs): Promise<BankingResponse> {
    return this.stub("EFT", args.idemKey, args.amountCents);
  }

  async bpay(args: BpayArgs): Promise<BankingResponse> {
    return this.stub("BPAY", args.idemKey, args.amountCents);
  }

  private stub(prefix: string, idemKey: string | undefined, amount: number): BankingResponse {
    const key = idemKey || randomUUID();
    const hash = createHash("sha256").update(`${prefix}:${key}:${amount}`).digest("hex");
    const provider_ref = `${prefix}-${hash.slice(0, 16)}`;
    return { provider_ref, paid_at: new Date().toISOString() };
  }
}
