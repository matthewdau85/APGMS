import { test } from "node:test";
import assert from "node:assert/strict";

import { computeSignature, verifySignature } from "../src/ingest/hmac";
import { payrollEventSchema, posEventSchema } from "../src/ingest/schemas";

const SECRET = "abcd1234";

test("verifySignature accepts valid payload", async () => {
  const payload = JSON.stringify({ foo: "bar" });
  const timestamp = Date.now().toString();
  const signature = computeSignature(SECRET, timestamp, payload);
  const result = await verifySignature({
    tenantId: "tenant",
    rawBody: payload,
    signature,
    timestamp,
    secretOverride: SECRET,
  });
  assert.equal(result.valid, true);
});

test("verifySignature rejects tampered payload", async () => {
  const payload = JSON.stringify({ foo: "bar" });
  const timestamp = Date.now().toString();
  const signature = computeSignature(SECRET, timestamp, payload);
  const result = await verifySignature({
    tenantId: "tenant",
    rawBody: JSON.stringify({ foo: "baz" }),
    signature,
    timestamp,
    secretOverride: SECRET,
  });
  assert.equal(result.valid, false);
});

test("payroll schema requires identifiers", () => {
  const parse = payrollEventSchema.safeParse({
    type: "STP",
    totals: { w1: 1, w2: 1 },
    employees: [],
  });
  assert.equal(parse.success, false);
});

test("pos schema parses valid payload", () => {
  const parse = posEventSchema.safeParse({
    type: "POS",
    tenantId: "tenant",
    taxType: "GST",
    periodId: "2025-Q1",
    sourceId: "pos-1",
    totals: { g1: 10, g10: 2, g11: 8, taxCollected: 1 },
  });
  assert.equal(parse.success, true);
  if (parse.success) {
    assert.equal(parse.data.tenantId, "tenant");
  }
});
