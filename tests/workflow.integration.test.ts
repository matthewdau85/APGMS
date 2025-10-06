import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import nacl from "tweetnacl";
import { newDb } from "pg-mem";
import { getPool, setPoolFactory } from "../src/db/pool";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runMigrations() {
  const pool = getPool();
  const coreSql = await fs.readFile(path.resolve(__dirname, "../migrations/001_apgms_core.sql"), "utf8");
  await pool.query(coreSql);
}

test("seed to evidence workflow includes rates_version", async () => {
  const db = newDb({ autoCreateForeignKeyIndices: true });
  const pg = db.adapters.createPg();
  setPoolFactory(() => new pg.Pool());

  await runMigrations();
  const pool = getPool();

  const abn = "12345678901";
  const taxType = "GST";
  const periodId = "2025-09";

  await pool.query(
    `insert into owa_ledger (abn,tax_type,period_id,transfer_uuid,amount_cents,balance_after_cents,bank_receipt_hash)
     values ($1,$2,$3,$4,$5,$6,$7)`,
    [abn, taxType, periodId, "seed-ledger", 150000, 150000, "seed-receipt"]
  );

  const thresholds = { epsilon_cents: 0, variance_ratio: 0.2, dup_rate: 0.05, gap_minutes: 60, delta_vs_baseline: 0.1 };
  const anomalyVector = { variance_ratio: 0, dup_rate: 0, gap_minutes: 0, delta_vs_baseline: 0 };

  const { calculateGst } = await import("../src/utils/gst");
  const { calculatePaygw } = await import("../src/utils/paygw");
  const gstDue = Math.round(calculateGst({ saleAmount: 1500000, exempt: false }));
  const paygwDue = calculatePaygw({ grossIncome: 2500000, taxWithheld: 500000, period: "monthly", deductions: 10000 });

  assert.ok(gstDue > 0, "GST liability should be positive");
  assert.ok(paygwDue >= 0, "PAYGW liability should be non-negative");

  await pool.query(
    `insert into periods (abn,tax_type,period_id,state,accrued_cents,credited_to_owa_cents,final_liability_cents,thresholds,anomaly_vector)
     values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb)`,
    [
      abn,
      taxType,
      periodId,
      "CLOSING",
      gstDue,
      gstDue,
      gstDue,
      JSON.stringify(thresholds),
      JSON.stringify(anomalyVector),
    ]
  );

  const keyPair = nacl.sign.keyPair();
  process.env.RPT_ED25519_SECRET_BASE64 = Buffer.from(keyPair.secretKey).toString("base64");
  process.env.ATO_PRN = "ATO-PRN";

  const { issueRPT } = await import("../src/rpt/issuer");
  const rpt = await issueRPT(abn, taxType, periodId, thresholds);
  assert.equal(rpt.payload.amount_cents, gstDue);

  const { releasePayment } = await import("../src/rails/adapter");
  const release = await releasePayment(abn, taxType, periodId, rpt.payload.amount_cents, "EFT", rpt.payload.reference);
  assert.ok(release.transfer_uuid, "Release should produce a transfer UUID");

  const { buildEvidenceBundle } = await import("../src/evidence/bundle");
  const evidence = await buildEvidenceBundle(abn, taxType, periodId);
  const { getRulesEngine } = await import("../src/rules/engine");
  const engine = getRulesEngine();

  assert.equal(evidence.rules_manifest.rates_version, engine.ratesVersion());
  assert.equal(evidence.rpt_payload.amount_cents, rpt.payload.amount_cents);

  const ledgerAfter = await pool.query(
    "select balance_after_cents from owa_ledger where abn = $1 and tax_type = $2 and period_id = $3 order by id desc limit 1",
    [abn, taxType, periodId]
  );
  assert.equal(Number(ledgerAfter.rows[0].balance_after_cents), 0);

  await pool.end();
  setPoolFactory(null);
});
