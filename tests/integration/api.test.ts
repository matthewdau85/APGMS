import "./setupEnv.ts";
import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { AddressInfo } from "node:net";
import { getPool } from "../../src/db/pool.ts";

const pool = getPool();
let baseUrl = "";
let server: import("http").Server;

before(async () => {
  const { createApp } = await import("../../src/index.ts");
  const app = createApp();
  server = app.listen(0);
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  if (!server) return;
  await new Promise<void>((resolve, reject) => {
    server.close(err => (err ? reject(err) : resolve()));
  });
});

const abn = "53004085616";
const taxType = "GST";
const periodId = "2024Q4";
const thresholds = { epsilon_cents: 50, variance_ratio: 0.25, dup_rate: 0.01, gap_minutes: 60, delta_vs_baseline: 0.2 };

beforeEach(async () => {
  await pool.query("TRUNCATE audit_log, idempotency_keys, owa_ledger, rpt_tokens, remittance_destinations, periods RESTART IDENTITY");
  await pool.query(
    "INSERT INTO periods (abn, tax_type, period_id, state, accrued_cents, credited_to_owa_cents, final_liability_cents, merkle_root, running_balance_hash, anomaly_vector, thresholds) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
    [
      abn,
      taxType,
      periodId,
      "CLOSING",
      125000,
      125000,
      125000,
      "merkle-root",
      "running-hash",
      {},
      thresholds
    ]
  );
  await pool.query(
    "INSERT INTO remittance_destinations (abn, label, rail, reference, account_bsb, account_number) VALUES ($1,$2,$3,$4,$5,$6)",
    [abn, "Primary", "EFT", process.env.ATO_PRN, "123-456", "987654"]
  );
});

test("reconcile endpoints succeed against seeded database", async () => {
  const closeRes = await fetch(`${baseUrl}/api/close-issue`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ abn, taxType, periodId, thresholds })
  });
  assert.equal(closeRes.status, 200);
  const closeBody = await closeRes.json();
  assert.equal(closeBody.payload.entity_id, abn);
  assert.equal(closeBody.payload.amount_cents, 125000);
  assert.ok(closeBody.signature, "expected RPT signature");

  const payRes = await fetch(`${baseUrl}/api/pay`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": "idem-pay-1"
    },
    body: JSON.stringify({ abn, taxType, periodId, rail: "EFT" })
  });
  assert.equal(payRes.status, 200);
  const payBody = await payRes.json();
  assert.ok(payBody.transfer_uuid, "expected transfer UUID");
  assert.ok(payBody.bank_receipt_hash, "expected bank receipt hash");

  const csvPayload = "txn_id,gst_cents,net_cents,settlement_ts\n1,100,900,2024-01-01T00:00:00Z";
  const settlementRes = await fetch(`${baseUrl}/api/settlement/webhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ csv: csvPayload })
  });
  assert.equal(settlementRes.status, 200);
  const settlementBody = await settlementRes.json();
  assert.equal(settlementBody.ingested, 1);

  const evidenceRes = await fetch(`${baseUrl}/api/evidence?abn=${encodeURIComponent(abn)}&taxType=${taxType}&periodId=${periodId}`);
  assert.equal(evidenceRes.status, 200);
  const evidenceBody = await evidenceRes.json();
  assert.ok(Array.isArray(evidenceBody.owa_ledger_deltas));
  assert.equal(evidenceBody.rpt_payload.entity_id, abn);
  assert.equal(evidenceBody.bank_receipt_hash, payBody.bank_receipt_hash);
});
