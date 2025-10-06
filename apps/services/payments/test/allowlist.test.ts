import test from "node:test";
import assert from "node:assert/strict";
import { validateABNAllowlist, validateBSB, validateCRN } from "../src/release/validators";

test("allowlist ok for ATO BPAY", () => {
  const err = validateABNAllowlist("12345678901", "BPAY", { bpay_biller: "75556", crn: "12345678901" }, "req-1");
  assert.equal(err, null);
  assert.equal(validateCRN("12345678901", "req-1"), null);
});

test("deny non-ATO", () => {
  const err = validateABNAllowlist("123", "BPAY", { bpay_biller: "12345", crn: "000" }, "req-2");
  assert.ok(err);
});

test("bsb must be six digits", () => {
  const err = validateBSB("12345", "req-3");
  assert.equal(err?.code, "INVALID_BSB");
});
