import test from "node:test";
import assert from "node:assert/strict";
import { SimRail } from "../../src/adapters/bank/SimRail";

test("same Idempotency-Key yields same provider_ref", async () => {
  const sim = new SimRail({ clock: () => new Date("2025-01-01T00:00:00Z") });
  const opts = {
    amount_cents: 12345,
    bsb: "082001",
    account: "12345678",
    reference: "ATO PAYGW",
    idempotencyKey: "release-key-1",
  };
  const first = await sim.eft(opts);
  const second = await sim.eft(opts);
  assert.equal(second.provider_ref, first.provider_ref);
  assert.equal(second.paid_at, first.paid_at);
});
