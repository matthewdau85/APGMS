import { BankingPort } from "../../ports/banking";

let counter = 0;

export class MockBanking implements BankingPort {
  async eft(abn: string, amountCents: number, reference?: string) {
    return this.buildResponse("eft", { abn, amountCents, reference });
  }

  async bpay(abn: string, crn: string, amountCents: number) {
    return this.buildResponse("bpay", { abn, crn, amountCents });
  }

  async payToSweep(mandateId: string, amountCents: number, ref: string) {
    return this.buildResponse("payToSweep", { mandateId, amountCents, ref });
  }

  private async buildResponse(channel: string, payload: Record<string, unknown>) {
    const id = `mock-${channel}-${++counter}`;
    void payload;
    return { id, status: "MOCKED" };
  }
}
