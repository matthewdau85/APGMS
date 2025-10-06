import { SimRail, InMemorySimSettlementRepository } from "../src/bank/simRail.js";

const fixedDate = new Date("2025-01-02T03:04:05.000Z");

test("idempotency key stable", async () => {
  const repo = new InMemorySimSettlementRepository();
  const rail = new SimRail({ repository: repo, clock: () => fixedDate });

  const baseRequest = {
    abn: "12345678901",
    taxType: "GST",
    periodId: "2025-09",
    amountCents: -5000,
    destination: { rail: "EFT" as const, bsb: "123456", account: "000123456" },
    idemKey: "release:12345678901:GST:2025-09",
  };

  const first = await rail.release(baseRequest);
  const second = await rail.release({ ...baseRequest, amountCents: -7500 });

  expect(first.providerRef).toEqual(second.providerRef);
  expect(second.paidAt.toISOString()).toEqual(fixedDate.toISOString());
});