import crypto from "crypto";
import { BankingPort, Tx } from "../../ports/banking";

export class MockBanking implements BankingPort {
  private mk(abn: string, amountCents: number, channel: Tx["channel"], reference?: string): Tx {
    return { id: crypto.randomUUID(), abn, amountCents, channel, reference, status: "PENDING" };
  }

  async eft(abn: string, amountCents: number, reference?: string) {
    return this.mk(abn, amountCents, "EFT", reference);
  }

  async bpay(abn: string, amountCents: number, reference?: string) {
    return this.mk(abn, amountCents, "BPAY", reference);
  }

  async payToSweep(_mandateId: string, amountCents: number, ref: string) {
    const abn = "mock-abn";
    return this.mk(abn, amountCents, "PayTo", ref);
  }
}
