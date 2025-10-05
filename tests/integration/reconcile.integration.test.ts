import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { AddressInfo } from "node:net";
import { once } from "node:events";
import nacl from "tweetnacl";
import { setPool, shutdownPool } from "../../src/db/pool";
import { FakePool } from "./fakePool";

async function setupServer() {
  const fakePool = new FakePool();
  setPool(fakePool);
  const [idempotencyModule, reconcile] = await Promise.all([
    import("../../src/middleware/idempotency"),
    import("../../src/routes/reconcile"),
  ]);
  const idempotency = idempotencyModule.idempotency;
  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.post("/api/pay", idempotency(), reconcile.payAto);
  app.post("/api/close-issue", reconcile.closeAndIssue);
  app.post("/api/payto/sweep", reconcile.paytoSweep);
  app.post("/api/settlement/webhook", reconcile.settlementWebhook);
  app.get("/api/evidence", reconcile.evidence);
  const server = app.listen(0);
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;
  return { fakePool, server, baseUrl };
}

async function postJson(baseUrl: string, path: string, body: any, headers: Record<string, string> = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  return { status: res.status, json };
}

async function getJson(baseUrl: string, path: string) {
  const res = await fetch(`${baseUrl}${path}`);
  const json = await res.json();
  return { status: res.status, json };
}

test("reconcile release flow executes against Postgres queries", async (t) => {
  const { fakePool, server, baseUrl } = await setupServer();
  t.after(() => {
    server.close();
    return shutdownPool();
  });

  const keyPair = nacl.sign.keyPair();
  process.env.RPT_ED25519_SECRET_BASE64 = Buffer.from(keyPair.secretKey).toString("base64");
  process.env.ATO_PRN = "PAYREF123";

  fakePool.reset();
  const abn = "12345678901";
  const taxType = "GST";
  const periodId = "2025-09";

  fakePool.addPeriod({
    abn,
    tax_type: taxType,
    period_id: periodId,
    state: "CLOSING",
    final_liability_cents: 5000,
    credited_to_owa_cents: 5000,
    anomaly_vector: {},
    thresholds: { epsilon_cents: 50 },
    merkle_root: "merkle",
    running_balance_hash: "hash0",
  });

  fakePool.addRemittanceDestination({
    abn,
    rail: "EFT",
    reference: process.env.ATO_PRN!,
  });

  fakePool.addOwaLedger({
    abn,
    tax_type: taxType,
    period_id: periodId,
    transfer_uuid: "seed-ledger",
    amount_cents: 5000,
    balance_after_cents: 5000,
    bank_receipt_hash: "seed",
    prev_hash: "",
    hash_after: "hash-seed",
  });

  const close = await postJson(baseUrl, "/api/close-issue", { abn, taxType, periodId });
  assert.equal(close.status, 200);
  assert.equal(close.json.payload.entity_id, abn);
  assert.ok(close.json.signature);

  const pay = await postJson(
    baseUrl,
    "/api/pay",
    { abn, taxType, periodId, rail: "EFT" },
    { "Idempotency-Key": "release-1" }
  );
  assert.equal(pay.status, 200);
  assert.match(pay.json.transfer_uuid, /^[0-9a-f-]+$/);
  assert.ok(pay.json.bank_receipt_hash);

  const evidenceResp = await getJson(baseUrl, `/api/evidence?abn=${abn}&taxType=${taxType}&periodId=${periodId}`);
  assert.equal(evidenceResp.status, 200);
  assert.equal(evidenceResp.json.owa_ledger_deltas.length, 2);
  assert.equal(evidenceResp.json.rpt_payload.entity_id, abn);

  const settlementCsv = "txn_id,gst_cents,net_cents,settlement_ts\\n1,10,90,2025-10-05T00:00:00Z\\n";
  const settlement = await postJson(baseUrl, "/api/settlement/webhook", { csv: settlementCsv });
  assert.equal(settlement.status, 200);
  assert.equal(typeof settlement.json.ingested, "number");

  const snapshot = fakePool.snapshot();
  assert.equal(snapshot.rpt_tokens.length, 1);
  assert.equal(snapshot.owa_ledger.length, 2);
  assert.ok(snapshot.idempotency_keys.some(k => k.last_status === "DONE"));
  assert.equal(snapshot.periods[0]?.state, "RELEASED");
});
