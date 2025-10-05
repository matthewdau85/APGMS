import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { ATO_RATES } from "../src/config/ato";
import { calculatePenalties } from "../src/utils/penalties";
import { generateTaxReport } from "../src/utils/taxReport";

const EXPECTED_PENALTY_UNIT = 330;
const EXPECTED_GIC_RATE = 0.1134;

describe("ATO configuration", () => {
  it("matches the published penalty unit and GIC rate used in regression examples", () => {
    assert.equal(
      ATO_RATES.penaltyUnitValue,
      EXPECTED_PENALTY_UNIT,
      "ATO penalty unit has changed — update penalty regression tests",
    );
    assert.equal(
      ATO_RATES.gicAnnualRate,
      EXPECTED_GIC_RATE,
      "ATO GIC rate has changed — update penalty regression tests",
    );
  });
});

describe("calculatePenalties", () => {
  it("applies 2 penalty units for a small entity 45 days late (ATO FTL example)", () => {
    const breakdown = calculatePenalties(45, 0, "small");
    assert.equal(breakdown.penaltyPeriods, 2);
    assert.equal(breakdown.ftlPenalty, EXPECTED_PENALTY_UNIT * 2);
    assert.equal(breakdown.totalPenalty, breakdown.ftlPenalty);
  });

  it("doubles the penalty units for a medium entity as per ATO guidance", () => {
    const breakdown = calculatePenalties(45, 0, "medium");
    assert.equal(breakdown.penaltyPeriods, 2);
    assert.equal(breakdown.ftlPenalty, EXPECTED_PENALTY_UNIT * 4);
  });

  it("compounds GIC daily using the published rate", () => {
    const breakdown = calculatePenalties(30, 10_000, "small");
    assert.equal(breakdown.ftlPenalty, EXPECTED_PENALTY_UNIT * 2); // 30 days => 2 penalty periods
    assert.equal(breakdown.gicInterest, 93.63);
    assert.equal(breakdown.totalPenalty, breakdown.ftlPenalty + breakdown.gicInterest);
  });
});

describe("generateTaxReport", () => {
  it("surfaces separate FTL and GIC components in the report", () => {
    const report = generateTaxReport({
      paygwLiability: 7500,
      gstPayable: 2500,
      daysLate: 30,
      entitySize: "small",
      discrepancies: [],
    });

    const expectedPenalty = calculatePenalties(30, 10_000, "small");

    assert.equal(report.paygwLiability, 7500);
    assert.equal(report.gstPayable, 2500);
    assert.equal(report.ftlPenalty, expectedPenalty.ftlPenalty);
    assert.equal(report.gicInterest, expectedPenalty.gicInterest);
    assert.equal(report.totalPayable, 10_000 + expectedPenalty.totalPenalty);
    assert.ok(["WARNING", "ALERT"].includes(report.complianceStatus));
  });
});
