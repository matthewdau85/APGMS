import test from "node:test";
import assert from "node:assert/strict";
import { calculateGst, manifestVersion } from "../../src/tax/paygw";

process.env.NODE_ENV = "test";
process.env.RATES_VERSION = "2024-25";

test("GST 10 percent with rounding", () => {
  const res = calculateGst(1000);
  assert.equal(res.gst_cents, 100);
  assert.equal(res.net_cents, 900);
});

test("GST rounds up half cent", () => {
  const res = calculateGst(999);
  assert.equal(res.gst_cents, 100);
});

test("Manifest version exposed", () => {
  assert.equal(manifestVersion(), "2024-25");
});
