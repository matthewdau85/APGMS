import assert from "node:assert/strict";
import test from "node:test";

process.env.FEATURE_BANKING = "true";
process.env.BANKING_SANDBOX_URL = "stub://sandbox";
process.env.BANKING_ABN_ALLOWLIST = "12345678901";

import { createStore, FakePool } from "./fakePool";

test("same idempotency key returns the same provider_ref", async () => {
  const { releaseToBank } = await import("../../src/payments/release");
  const { sandboxBankingPort } = await import("../../src/rails/adapters/sandbox");
  const store = createStore();
  store.remittance_destinations.push({
    abn: "12345678901",
    rail: "EFT",
    reference: "REF123",
    account_bsb: "123456",
    account_number: "98765432",
    label: "ATO PAYGW",
  });
  store.owa_ledger.push({
    id: 1,
    abn: "12345678901",
    tax_type: "PAYGW",
    period_id: "2025-09",
    amount_cents: 200_000,
    balance_after_cents: 200_000,
    created_at: new Date().toISOString(),
  });
  store.sequences.owaLedger = 1;

  const pool = new FakePool(store);
  const deps = { pool, banking: sandboxBankingPort, featureBanking: true } as const;
  const input = {
    abn: "12345678901",
    taxType: "PAYGW",
    periodId: "2025-09",
    rail: "EFT" as const,
    reference: "REF123",
    amountCents: 50_000,
    idempotencyKey: "idem-key-1",
  };

  const first = await releaseToBank(input, deps);
  const second = await releaseToBank(input, deps);

  assert.equal(first.providerRef, second.providerRef);
  assert.equal(store.settlements.length, 1);
  assert.equal(store.owa_ledger.length, 2); // deposit + release
  assert.ok(first.paidAt);
});
