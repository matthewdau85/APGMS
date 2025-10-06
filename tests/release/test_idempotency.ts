import test from "node:test";
import assert from "node:assert/strict";
import { FakePool } from "../helpers/fakePool";
import { setPoolForTests } from "../../src/db/pool";
import { periodUuid } from "../../src/release/period";

process.env.FEATURE_SIM_OUTBOUND = "true";
process.env.FEATURE_BANKING = "false";

function setupPool() {
  const pool = new FakePool();
  setPoolForTests(pool as any);
  pool.seedPeriod("12345678901", "GST", "2025-09", "READY_RPT", {});
  pool.seedRpt("12345678901", "GST", "2025-09", { amount_cents: 5000, reference: "PRN123" }, { kid: "XYZ" });
  pool.seedDestination({ abn: "12345678901", rail: "EFT", reference: "PRN123", account_bsb: "123456", account_number: "12345678" });
  return pool;
}

test("same idempotency key returns same provider_ref", async () => {
  const pool = setupPool();
  const { executeRelease } = await import("../../src/release/service");

  const first = await executeRelease({
    abn: "12345678901",
    taxType: "GST",
    periodId: "2025-09",
    rail: "EFT",
    requestId: "req-1",
    idempotencyKey: "idem-abc",
  });

  const second = await executeRelease({
    abn: "12345678901",
    taxType: "GST",
    periodId: "2025-09",
    rail: "EFT",
    requestId: "req-2",
    idempotencyKey: "idem-abc",
  });

  assert.equal(first.provider_ref, second.provider_ref);
  assert.equal(first.reused, false);
  assert.equal(second.reused, true);
  assert.equal(pool.settlements.length, 1);
  const stored = pool.getSettlementByRef(first.provider_ref);
  assert.ok(stored, "settlement persisted");
  assert.equal(stored?.period_id, periodUuid("12345678901", "GST", "2025-09"));

  setPoolForTests(null as any);
});
