import test from "node:test";
import assert from "node:assert/strict";
import { SimRail } from "../../src/adapters/bank/SimRail";
import { applyRecon, parseReconInput } from "../../src/recon/importer";
import { buildEvidenceBundle } from "../../src/evidence/bundle";
import { recordReleaseSuccess, resetReleaseStore } from "../../src/release/store";

test("import file links settlement into evidence", async () => {
  resetReleaseStore();
  const sim = new SimRail({ clock: () => new Date("2025-02-01T00:00:00Z") });
  const settlement = await sim.bpay({
    amount_cents: 5000,
    biller_code: "75556",
    crn: "12345678901",
    reference: "ATO PAYGW",
    idempotencyKey: "recon-1",
  });

  recordReleaseSuccess({
    abn: "12345678901",
    taxType: "PAYGW",
    periodId: "2025-09",
    amount_cents: 5000,
    rail: "BPAY",
    destination: { bpay_biller: "75556", crn: "12345678901" },
    provider_ref: settlement.provider_ref,
    paid_at: settlement.paid_at,
    idempotency_key: "BPAY:recon-1",
    requestId: "req-abc",
    approvals: [
      { by: "alice", role: "maker", at: "2025-02-01T00:00:00Z" },
      { by: "bob", role: "checker", at: "2025-02-01T00:01:00Z" },
    ],
    simulated: true,
  });

  const csv = `provider_ref,amount_cents,paid_at\n${settlement.provider_ref},5000,${settlement.paid_at}\n`;
  const rows = parseReconInput({ csv });
  const summary = applyRecon(rows);
  assert.equal(summary.matched, 1);
  assert.equal(summary.unmatched, 0);

  const bundle = await buildEvidenceBundle("12345678901", "PAYGW", "2025-09");
  assert.equal(bundle.settlement.provider_ref, settlement.provider_ref);
  assert.equal(bundle.settlement.simulated, true);
  assert.ok(bundle.narrative.includes("RECON_OK"));
  assert.equal(bundle.approvals.length, 2);
  assert.equal(bundle.rules.manifest_sha256.length, 64);
});
