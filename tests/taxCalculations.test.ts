import { strict as assert } from "assert";
import { calculatePaygw } from "../src/utils/paygw";
import { calculateGst } from "../src/utils/gst";
import { calculatePenalties } from "../src/utils/penalties";

type Approx = {
  expected: number;
  actual: number;
  tolerance?: number;
};

function assertApprox({ expected, actual, tolerance = 0.02 }: Approx) {
  const withinTolerance = Math.abs(expected - actual) <= tolerance;
  if (!withinTolerance) {
    assert.fail(`Expected ${expected.toFixed(2)} but received ${actual.toFixed(2)}`);
  }
}

(function testWeeklyMiddleBand() {
  const breakdown = calculatePaygw({
    employeeName: "Test", grossIncome: 800, taxWithheld: 70, period: "weekly", deductions: 0,
  });
  assertApprox({ expected: 41_600, actual: breakdown.annualisedIncome, tolerance: 0.5 });
  assertApprox({ expected: 72, actual: breakdown.requiredWithholding });
  assertApprox({ expected: 70, actual: breakdown.amountAlreadyWithheld });
  assertApprox({ expected: 2, actual: breakdown.shortfall });
})();

(function testMonthlyHigherBand() {
  const breakdown = calculatePaygw({
    employeeName: "Senior", grossIncome: 10_000, taxWithheld: 2_000, period: "monthly", deductions: 0,
  });
  assertApprox({ expected: 120_000, actual: breakdown.annualisedIncome, tolerance: 0.5 });
  assertApprox({ expected: 2_232.33, actual: breakdown.requiredWithholding, tolerance: 0.03 });
  assertApprox({ expected: 232.33, actual: breakdown.shortfall, tolerance: 0.03 });
})();

(function testQuarterlyTopBandWithDeductions() {
  const breakdown = calculatePaygw({
    employeeName: "Director", grossIncome: 60_000, taxWithheld: 18_000, period: "quarterly", deductions: 100,
  });
  assertApprox({ expected: 240_000, actual: breakdown.annualisedIncome, tolerance: 0.5 });
  assertApprox({ expected: 18_534.5, actual: breakdown.requiredWithholding, tolerance: 0.05 });
  assertApprox({ expected: 434.5, actual: breakdown.shortfall, tolerance: 0.05 });
})();

(function testGstInclusiveCalculation() {
  const gst = calculateGst({ saleAmount: 1_210 });
  assert.equal(gst.isExempt, false);
  assertApprox({ expected: 110, actual: gst.gstPayable });
  assertApprox({ expected: 1_100, actual: gst.taxableAmount });
})();

(function testGstExempt() {
  const gst = calculateGst({ saleAmount: 500, exempt: true });
  assert.equal(gst.isExempt, true);
  assertApprox({ expected: 500, actual: gst.taxableAmount });
  assertApprox({ expected: 0, actual: gst.gstPayable });
})();

(function testPenaltiesSmallEntity() {
  const penalties = calculatePenalties(45, 10_000, "small");
  const dailyRate = 0.1134 / 365;
  const expectedGic = 10_000 * (Math.pow(1 + dailyRate, 45) - 1);
  assertApprox({ expected: expectedGic, actual: penalties.generalInterestCharge, tolerance: 0.1 });
  assertApprox({ expected: 660, actual: penalties.failureToLodgePenalty });
  assertApprox({ expected: penalties.generalInterestCharge + penalties.failureToLodgePenalty, actual: penalties.total, tolerance: 0.05 });
})();

console.log("All tax calculation tests passed.");
