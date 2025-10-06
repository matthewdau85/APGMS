import assert from "assert";
import { promises as fs } from "fs";
import path from "path";
import { Pool } from "pg";
import { ensureSettlementSchema } from "../../src/settlement/schema";
import { releaseToProvider } from "../../src/payments/release";
import { fetchReconRows } from "../../src/sim/rail/recon";
import { importSettlementRows } from "../../src/settlement/import";
import { buildEvidenceBundle } from "../../src/evidence/bundle";

const pool = new Pool();

export async function testReconImportEvidence() {
  process.env.FEATURE_SIM_OUTBOUND = "true";
  process.env.RATES_VERSION = "test-version";
  try {
    await ensureSettlementSchema();
  } catch (err: any) {
    if (err?.code === "ECONNREFUSED") {
      console.warn("Skipping recon evidence test: database unavailable");
      return;
    }
    throw err;
  }

  const abn = `EVID-${Math.floor(Math.random() * 1e6)}`;
  const taxType = "GST";
  const periodId = `2025-${Math.floor(Math.random() * 12 + 1).toString().padStart(2, "0")}`;
  const amountCents = 99000;
  const reference = `PRN-${Math.floor(Math.random() * 1e6)}`;

  await pool.query(
    `insert into periods(abn,tax_type,period_id,state,accrued_cents,credited_to_owa_cents,final_liability_cents)
     values($1,$2,$3,'READY_RPT',$4,$5,$6)
     on conflict(abn,tax_type,period_id) do update set state='READY_RPT'`,
    [abn, taxType, periodId, amountCents, amountCents, amountCents]
  );
  await pool.query(
    `insert into remittance_destinations(abn,label,rail,reference)
     values($1,$2,'EFT',$3)
     on conflict(abn,rail,reference) do nothing`,
    [abn, "EFT seed", reference]
  );
  await pool.query(
    `insert into rpt_tokens(abn,tax_type,period_id,payload,signature,status)
     values($1,$2,$3,$4,$5,'ISSUED')
     on conflict(abn,tax_type,period_id) do update set payload=excluded.payload`,
    [
      abn,
      taxType,
      periodId,
      {
        entity_id: abn,
        period_id: periodId,
        tax_type: taxType,
        amount_cents: amountCents,
        rail_id: "EFT",
        reference,
        anomaly_vector: {},
        thresholds: {},
        expiry_ts: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        nonce: "seed",
      },
      "sig",
    ]
  );

  await fs.mkdir(path.resolve("dist/rules"), { recursive: true });
  const manifest = {
    version: "test-version",
    files: [{ name: "rule.json", sha256: "abc123" }],
  };
  const manifestSha = require("crypto").createHash("sha256").update(JSON.stringify(manifest)).digest("hex");
  await fs.writeFile(
    path.resolve("dist/rules/manifest.json"),
    JSON.stringify({ ...manifest, manifest_sha256: manifestSha }, null, 2)
  );

  const releaseResult = await releaseToProvider({
    abn,
    taxType,
    periodId,
    amountCents,
    rail: "EFT",
    reference,
    idempotencyKey: `KEY-${Date.now()}`,
    actor: "tester",
  });

  const reconRows = await fetchReconRows();
  assert.ok(reconRows.some((row) => row.provider_ref === releaseResult.provider_ref));

  await importSettlementRows(reconRows, "test");

  const bundle = await buildEvidenceBundle(abn, taxType, periodId);
  assert.ok(bundle.rules?.manifest_sha256, "rules manifest missing");
  assert.strictEqual(bundle.rules?.manifest_sha256, manifestSha);
  assert.strictEqual(bundle.settlement?.provider_ref, releaseResult.provider_ref);
  assert.ok(Array.isArray(bundle.approvals) && bundle.approvals.length >= 1);
  assert.ok(typeof bundle.narrative === "string" && bundle.narrative.includes(releaseResult.provider_ref));
}
