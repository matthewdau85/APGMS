import { test } from "node:test";
import assert from "node:assert/strict";
import {
  insertIdempotencyKey,
  insertOwaLedgerEntry,
  insertRptToken,
  selectLatestLedgerBalance,
  selectPeriodByKey,
  updateIdempotencyOutcome,
} from "../src/db/queries";

test("selectPeriodByKey uses positional parameters", () => {
  const q = selectPeriodByKey("123", "GST", "2025-09");
  assert.equal(q.text.includes("abn=$1"), true);
  assert.deepEqual(q.values, ["123", "GST", "2025-09"]);
});

test("insertRptToken provides canonical columns", () => {
  const now = new Date("2024-01-01T00:00:00Z");
  const q = insertRptToken({
    abn: "123",
    taxType: "GST",
    periodId: "2025-09",
    payload: { ok: true },
    signature: "sig",
    payloadC14n: "{}",
    payloadSha256: "abc",
    nonce: "nonce",
    expiresAt: now,
  });
  assert.match(q.text, /INSERT INTO rpt_tokens/);
  assert.equal(q.values[0], "123");
  assert.equal(q.values[6], "abc");
  assert.equal(q.values[8], now);
});

test("insertIdempotencyKey stores request hash and scope", () => {
  const q = insertIdempotencyKey("key1", "hash1", "scopeA");
  assert.match(q.text, /INSERT INTO idempotency_keys/);
  assert.deepEqual(q.values, ["key1", "hash1", "scopeA"]);
});

test("updateIdempotencyOutcome updates status and body", () => {
  const q = updateIdempotencyOutcome("key1", 200, { ok: true }, "SUCCESS");
  assert.match(q.text, /UPDATE idempotency_keys/);
  assert.equal(q.values[0], "key1");
  assert.equal(q.values[1], 200);
  assert.deepEqual(q.values[2], { ok: true });
});

test("insertOwaLedgerEntry stores ledger tuple", () => {
  const q = insertOwaLedgerEntry("123", "GST", "2025-09", "uuid", 100, 200, "hash", null, "hash2");
  assert.match(q.text, /INSERT INTO owa_ledger/);
  assert.equal(q.values[5], 200);
  assert.equal(q.values[6], "hash");
});

test("selectLatestLedgerBalance orders by id desc", () => {
  const q = selectLatestLedgerBalance("123", "GST", "2025-09");
  assert.match(q.text, /ORDER BY id DESC/);
  assert.deepEqual(q.values, ["123", "GST", "2025-09"]);
});
