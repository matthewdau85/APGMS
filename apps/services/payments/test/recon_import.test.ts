import { linkSettlementsInMemory, ReconRecord } from "../src/settlement/recon.js";
import { buildEvidenceView } from "../src/evidence/view.js";
import type { RulesManifest } from "../src/evidence/rulesManifest.js";

test("import links settlement to evidence view", () => {
  const ledger = new Map([
    [
      "SIM-001",
      {
        provider_ref: "SIM-001",
        abn: "12345678901",
        tax_type: "GST",
        period_id: "2025-09",
      },
    ],
  ]);

  const records: ReconRecord[] = [
    { provider_ref: "SIM-001", amount_cents: 12345, paid_at: "2025-09-21T05:00:00Z" },
  ];

  const linked = linkSettlementsInMemory(records, ledger);
  expect(linked).toEqual([{ provider_ref: "SIM-001", period_id: "2025-09" }]);

  const manifest: RulesManifest = {
    version: "v-test",
    generated_at: new Date("2025-09-22T00:00:00Z").toISOString(),
    files: [],
    manifest_sha256: "abc123",
  };

  const view = buildEvidenceView(
    {
      abn: "12345678901",
      taxType: "GST",
      periodId: "2025-09",
      narrative: null,
      runningBalanceHash: null,
    },
    {
      provider_ref: "SIM-001",
      amount_cents: -12345,
      provider_paid_at: "2025-09-21T05:00:00.000Z",
      hash_after: "hash-after",
    },
    [],
    manifest,
  );

  expect(view.settlement).toEqual({
    provider_ref: "SIM-001",
    amount: 12345,
    paidAt: "2025-09-21T05:00:00.000Z",
  });
  expect(view.rules.manifest_sha256).toBe("abc123");
});

