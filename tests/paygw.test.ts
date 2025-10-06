import { test } from "node:test";
import { strict as assert } from "node:assert";
import { calculatePaygw } from "../src/utils/paygw";
import { calculateGst } from "../src/utils/gst";

test("PAYGW schedule 2024-25 - weekly withholding with LITO", () => {
  const result = calculatePaygw({
    employeeName: "Test",
    grossIncome: 1000,
    taxWithheld: 0,
    period: "weekly",
  });
  assert.equal(result.recommendedWithholding, 119);
  assert.equal(result.outstandingLiability, 119);
  assert.equal(result.basLabels.W2, 119);
  assert.ok(result.lowIncomeTaxOffset > 0);
});

test("PAYGW schedule 2024-25 - fortnightly rounding", () => {
  const result = calculatePaygw({
    employeeName: "Test",
    grossIncome: 2500,
    taxWithheld: 50,
    period: "fortnightly",
  });
  assert.equal(result.recommendedWithholding, 395);
  assert.equal(result.outstandingLiability, 345);
});

test("PAYGW schedule 2024-25 - monthly deductions", () => {
  const result = calculatePaygw({
    employeeName: "Test",
    grossIncome: 3000,
    taxWithheld: 150,
    period: "monthly",
    deductions: 200,
  });
  assert.equal(result.recommendedWithholding, 147);
  assert.equal(result.outstandingLiability, 0);
  assert.ok(result.lowIncomeTaxOffset >= 0);
});

test("GST BAS labels - taxable sales and purchases", () => {
  const result = calculateGst({ saleAmount: 1100, purchaseAmount: 220, exempt: false });
  assert.equal(result.basLabels.G1, 1100);
  assert.equal(result.basLabels["1A"], 100);
  assert.equal(result.basLabels["1B"], 20);
  assert.equal(result.netGst, 80);
});

test("GST BAS labels - exempt supply", () => {
  const result = calculateGst({ saleAmount: 500, exempt: true });
  assert.equal(result.netGst, 0);
  assert.equal(result.basLabels.G1, 0);
});
