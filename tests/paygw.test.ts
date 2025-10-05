import assert from "node:assert/strict";

import {
  calculatePaygw,
  calculateScheduledWithholding,
  getPaygwScheduleMetadata,
} from "../src/utils/paygw";

function assertAlmostEqual(actual: number, expected: number, precision = 2) {
  const factor = 10 ** precision;
  assert.equal(Math.round(actual * factor) / factor, expected);
}

(function run() {
  const weekly = calculateScheduledWithholding(500, "weekly");
  assertAlmostEqual(weekly, 15.04);

  const fortnightlyOutstanding = calculatePaygw({
    employeeName: "Case A",
    grossIncome: 2000,
    taxWithheld: 250,
    period: "fortnightly",
    deductions: 50,
  });
  assertAlmostEqual(fortnightlyOutstanding, 41.4);

  const monthlyOutstanding = calculatePaygw({
    employeeName: "Case B",
    grossIncome: 8000,
    taxWithheld: 1500,
    period: "monthly",
  });
  assertAlmostEqual(monthlyOutstanding, 359.33);

  const quarterly = calculateScheduledWithholding(12_000, "quarterly");
  assertAlmostEqual(quarterly, 1668, 0);

  const overWithheld = calculatePaygw({
    employeeName: "Case C",
    grossIncome: 1500,
    taxWithheld: 400,
    period: "weekly",
  });
  assertAlmostEqual(overWithheld, 0);

  const metadata = getPaygwScheduleMetadata();
  assert.deepEqual(metadata, {
    version: "Schedule 1 (NAT 1004)",
    effectiveFrom: "2024-07-01",
    source: "ATO PAYG withholding tax tables",
  });

  console.log("PAYGW withholding tests passed");
})();
