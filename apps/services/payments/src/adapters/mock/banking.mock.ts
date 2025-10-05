import { randomUUID } from "node:crypto";
import type { BankingPort } from "../../ports/banking";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function createMockBankingAdapter(): BankingPort {
  return {
    async eft(_abn, _amountCents, reference) {
      await delay(25);
      return { id: reference || `mock-eft-${randomUUID()}`, status: "mocked" };
    },
    async bpay(_abn, crn, _amountCents) {
      await delay(25);
      return { id: `mock-bpay-${crn}-${randomUUID()}`, status: "mocked" };
    },
  };
}
