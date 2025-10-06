import assert from "assert";
import { performSimRelease } from "../../src/sim/rail/provider";
import { ensureSettlementSchema } from "../../src/settlement/schema";

export async function testReleaseIdempotency() {
  process.env.FEATURE_SIM_OUTBOUND = "true";
  try {
    await ensureSettlementSchema();
  } catch (err: any) {
    if (err?.code === "ECONNREFUSED") {
      console.warn("Skipping idempotency test: database unavailable");
      return;
    }
    throw err;
  }
  const baseKey = `TEST-IDEM-${Date.now()}`;
  const abn = `IDEMP-${Math.floor(Math.random() * 1e6)}`;
  const period = `2025-${Math.floor(Math.random() * 12 + 1).toString().padStart(2, "0")}`;
  const params = {
    rail: "eft" as const,
    amount_cents: 12345,
    abn,
    period_id: period,
    idem_key: baseKey,
  };

  const first = await performSimRelease(params);
  const second = await performSimRelease(params);

  assert.strictEqual(first.provider_ref, second.provider_ref, "provider_ref should be stable for same key");
  assert.strictEqual(first.paid_at, second.paid_at, "paid_at should be stable for same key");
}
