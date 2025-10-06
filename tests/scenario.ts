import assert from "node:assert";
import crypto from "crypto";

import {
  addPayrollEvent,
  addPosEvent,
  addGateApproval,
  getGateRecord,
  getReconResult,
  recordSettlement,
  requestClosing,
  resetStore,
  setLedgerSnapshot,
  enqueueDlq,
  listDlq,
} from "../src/ingest/store";
import { processRecon } from "../src/recon/pipeline";
import { replayDlq } from "../src/recon/dlq";
import { buildEvidenceBundle } from "../src/evidence/bundle";
import { verifyHmac } from "../src/ingest/hmac";

async function run() {
  resetStore();
  const periodId = "2025-09";
  const secret = crypto.randomBytes(32).toString("base64");
  const body = JSON.stringify({ test: true });
  const digest = crypto.createHmac("sha256", Buffer.from(secret, "base64")).update(body).digest("hex");
  assert(verifyHmac(`sha256=${digest}`, body, secret));
  assert(!verifyHmac("sha256=deadbeef", body, secret), "invalid HMAC should fail");

  setLedgerSnapshot({ periodId, w1: 150000, w2: 36000, gst: 10000 });
  requestClosing(periodId);
  addPayrollEvent({
    employee_id_hash: "emp-001",
    period: periodId,
    gross: 120000,
    tax_withheld: 36000,
    allowances: 30000,
    stsl_flags: ["HELP"],
  });
  addPosEvent({
    txn_id: "txn-100",
    dt: `${periodId}-05T00:00:00.000Z`,
    net: 90000,
    gst: 10000,
    category: "POS",
    source: "SQUARE",
  });
  const reconOk = processRecon(periodId);
  assert.strictEqual(reconOk.status, "RECON_OK");
  const gateAfterOk = getGateRecord(periodId);
  assert.strictEqual(gateAfterOk.state, "READY_RPT");

  // Introduce mismatch by adjusting ledger
  setLedgerSnapshot({ periodId, w1: 160000, w2: 50000, gst: 12000 });
  const reconFail = processRecon(periodId);
  assert.strictEqual(reconFail.status, "RECON_FAIL");
  assert.ok(reconFail.reasons.length > 0);
  const gateAfterFail = getGateRecord(periodId);
  assert.strictEqual(gateAfterFail.state, "RECON_BLOCKED");

  // queue failure for replay
  const dlqItem = enqueueDlq("MANUAL_TEST", { periodId });
  setLedgerSnapshot({ periodId, w1: 150000, w2: 36000, gst: 10000 });
  const replayResult = replayDlq([dlqItem.id]);
  assert.strictEqual(replayResult[0].status, "REPLAYED");
  assert.strictEqual(listDlq().length, 0);
  const gateAfterReplay = getGateRecord(periodId);
  assert.strictEqual(gateAfterReplay.state, "READY_RPT");
  const reconAfterReplay = getReconResult(periodId);
  assert.strictEqual(reconAfterReplay?.status, "RECON_OK");

  // Capture approvals and settlement for evidence
  addGateApproval(periodId, { user: "auditor@example.com", ts: new Date().toISOString(), mfa: true });
  recordSettlement({
    periodId,
    channel: "EFT",
    provider_ref: "BANK123",
    amount_cents: 150000,
    paidAt: new Date().toISOString(),
    receiptPayload: { ref: "BANK123", status: "posted" },
  });

  const evidence = await buildEvidenceBundle(periodId);
  assert.ok(evidence.details.rules.files[0].sha256);
  assert.strictEqual(evidence.details.settlement.channel, "EFT");
  assert.ok(evidence.details.narrative.rationale.includes("Gate traversed"));
  const reconFinal = getReconResult(periodId);
  assert(reconFinal?.status === "RECON_OK" || reconFinal?.status === "RECON_FAIL");

  console.log("Scenario tests completed");
}

run();
