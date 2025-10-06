import test from "node:test";
import assert from "node:assert/strict";
import { FakePool } from "../helpers/fakePool";
import { setPoolForTests } from "../../src/db/pool";

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

function mockRes() {
  const res: any = {
    locals: { requestId: "req-recon", simulated: true },
    statusCode: 200,
    body: null as any,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: any) {
      this.body = payload;
      return payload;
    },
    setHeader() {},
  };
  return res;
}

test("reconciliation import links settlement and evidence", async () => {
  const pool = setupPool();
  const { executeRelease } = await import("../../src/release/service");
  const { settlementImport } = await import("../../src/routes/reconcile");
  const { buildEvidenceBundle } = await import("../../src/evidence/bundle");

  const release = await executeRelease({
    abn: "12345678901",
    taxType: "GST",
    periodId: "2025-09",
    rail: "EFT",
    requestId: "req-release",
    idempotencyKey: "idem-recon",
  });

  const req: any = {
    body: [
      {
        provider_ref: release.provider_ref,
        amount_cents: 5000,
        paid_at: release.paid_at,
      },
    ],
  };
  const res = mockRes();

  await settlementImport(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.imported, 1);
  assert.equal(res.body.matched, 1);

  const settlement = pool.getSettlementByRef(release.provider_ref);
  assert.ok(settlement?.meta?.reconciled_at, "settlement reconciled");
  assert.equal(pool.owa_ledger[0]?.rpt_verified, true);

  const bundle = await buildEvidenceBundle("12345678901", "GST", "2025-09", "req-evidence");
  assert.equal(bundle.settlement?.provider_ref, release.provider_ref);
  assert.equal(bundle.simulated, true);
  const hasApproval = bundle.approvals.some((a: any) => a.role === "SETTLEMENT");
  assert.ok(hasApproval, "settlement approval recorded");

  setPoolForTests(null as any);
});
