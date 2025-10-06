import assert from "node:assert/strict";
import test from "node:test";

process.env.FEATURE_BANKING = "true";
process.env.BANKING_SANDBOX_URL = "stub://sandbox";
process.env.BANKING_ABN_ALLOWLIST = "12345678901";

import { createStore, FakePool } from "./fakePool";

function baseLedger() {
  return {
    id: 1,
    abn: "12345678901",
    tax_type: "PAYGW",
    period_id: "2025-09",
    amount_cents: 100_000,
    balance_after_cents: 100_000,
    created_at: new Date().toISOString(),
  };
}

test("non-allowlisted destination blocks release", async () => {
  const { releaseToBank, ReleaseError } = await import("../../src/payments/release");
  const { sandboxBankingPort } = await import("../../src/rails/adapters/sandbox");
  const store = createStore();
  store.owa_ledger.push(baseLedger());
  store.sequences.owaLedger = 1;
  const pool = new FakePool(store);
  await assert.rejects(
    () =>
      releaseToBank(
        {
          abn: "12345678901",
          taxType: "PAYGW",
          periodId: "2025-09",
          rail: "EFT",
          reference: "REF-NO",
          amountCents: 10_000,
          idempotencyKey: "idem-missing",
        },
        { pool, banking: sandboxBankingPort, featureBanking: true }
      ),
    (err: unknown) => err instanceof ReleaseError && err.status === 400 && err.message === "DESTINATION_NOT_ALLOWLISTED"
  );
});

test("invalid BSB returns 400", async () => {
  const { releaseToBank, ReleaseError } = await import("../../src/payments/release");
  const { sandboxBankingPort } = await import("../../src/rails/adapters/sandbox");
  const store = createStore();
  store.owa_ledger.push(baseLedger());
  store.sequences.owaLedger = 1;
  store.remittance_destinations.push({
    abn: "12345678901",
    rail: "EFT",
    reference: "REFBAD",
    account_bsb: "12345",
    account_number: "1234567",
  });
  const pool = new FakePool(store);
  await assert.rejects(
    () =>
      releaseToBank(
        {
          abn: "12345678901",
          taxType: "PAYGW",
          periodId: "2025-09",
          rail: "EFT",
          reference: "REFBAD",
          amountCents: 10_000,
          idempotencyKey: "idem-bsb",
        },
        { pool, banking: sandboxBankingPort, featureBanking: true }
      ),
    (err: unknown) => err instanceof ReleaseError && err.status === 400 && err.message === "INVALID_BSB"
  );
});

test("invalid CRN returns 400", async () => {
  const { releaseToBank, ReleaseError } = await import("../../src/payments/release");
  const { sandboxBankingPort } = await import("../../src/rails/adapters/sandbox");
  const store = createStore();
  store.owa_ledger.push({ ...baseLedger(), id: 2, tax_type: "GST", period_id: "2025-09" });
  store.sequences.owaLedger = 2;
  store.remittance_destinations.push({
    abn: "12345678901",
    rail: "BPAY",
    reference: "1234",
    account_number: "bad",
  });
  const pool = new FakePool(store);
  await assert.rejects(
    () =>
      releaseToBank(
        {
          abn: "12345678901",
          taxType: "GST",
          periodId: "2025-09",
          rail: "BPAY",
          reference: "1234",
          amountCents: 5_000,
          idempotencyKey: "idem-crn",
        },
        { pool, banking: sandboxBankingPort, featureBanking: true }
      ),
    (err: unknown) => err instanceof ReleaseError && err.status === 400 && err.message === "INVALID_CRN"
  );
});
