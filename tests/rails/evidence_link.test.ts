import assert from "node:assert/strict";
import test from "node:test";

process.env.FEATURE_BANKING = "true";
process.env.BANKING_SANDBOX_URL = "stub://sandbox";
process.env.BANKING_ABN_ALLOWLIST = "12345678901";

import { createStore, FakePool } from "./fakePool";

test("evidence bundle includes provider_ref after import", async () => {
  const { releaseToBank } = await import("../../src/payments/release");
  const { sandboxBankingPort } = await import("../../src/rails/adapters/sandbox");
  const { importSettlementRows } = await import("../../src/rails/reconcile");
  const { buildEvidenceBundle, setEvidencePool } = await import("../../src/evidence/bundle");
  const store = createStore();
  store.remittance_destinations.push({
    abn: "12345678901",
    rail: "EFT",
    reference: "ATO-PRN",
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
  store.periods.push({
    id: 1,
    abn: "12345678901",
    tax_type: "PAYGW",
    period_id: "2025-09",
    thresholds: {},
  });
  store.rpt_tokens.push({
    id: 1,
    abn: "12345678901",
    tax_type: "PAYGW",
    period_id: "2025-09",
    payload: { reference: "ATO-PRN", amount_cents: 50_000 },
    signature: "sig",
  });

  const pool = new FakePool(store);
  setEvidencePool(pool as any);

  const release = await releaseToBank(
    {
      abn: "12345678901",
      taxType: "PAYGW",
      periodId: "2025-09",
      rail: "EFT",
      reference: "ATO-PRN",
      amountCents: 50_000,
      idempotencyKey: "idem-evidence",
    },
    { pool, banking: sandboxBankingPort, featureBanking: true }
  );

  await importSettlementRows(
    [
      {
        provider_ref: release.providerRef,
        abn: "12345678901",
        period_id: "2025-09",
        rail: release.rail,
        amount_cents: release.amountCents,
        paid_at: release.paidAt || new Date().toISOString(),
        receipt: { provider_ref: release.providerRef },
      },
    ],
    pool as any
  );

  const bundle = await buildEvidenceBundle("12345678901", "PAYGW", "2025-09");
  assert.equal(bundle.settlement?.provider_ref, release.providerRef);
  assert.equal(bundle.settlement?.amount_cents, release.amountCents);
});
