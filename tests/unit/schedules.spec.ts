import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { calculatePaygw } from "../../src/utils/paygw";
import { calculateGst } from "../../src/utils/gst";
import { calculatePenalties } from "../../src/utils/penalties";

function atoWeeklyPaygw(grossDollars: number): number {
  const grossCents = Math.round(grossDollars * 100);
  if (grossCents <= 0) return 0;
  const bracket = 80_000;
  if (grossCents <= bracket) return Math.round(grossCents * 0.15) / 100;
  const base = Math.round(bracket * 0.15);
  const excess = grossCents - bracket;
  return (base + Math.round(excess * 0.2)) / 100;
}

function atoPenalty(daysLate: number, amountDue: number): number {
  const basePenalty = amountDue * 0.10;
  const dailyInterest = amountDue * 0.0005;
  return basePenalty + dailyInterest * daysLate;
}

describe("schedule comparisons", () => {
  it("PAYGW placeholder over-withholds compared to ATO schedule", () => {
    const grossIncome = 5_000;
    const ato = atoWeeklyPaygw(grossIncome);
    const placeholder = calculatePaygw({ grossIncome, taxWithheld: 0, period: "weekly" });
    assert.ok(placeholder > ato, "placeholder should withhold more than ATO progressive scale");
    assert.ok(Math.abs(placeholder - ato) < 100, "difference stays within a realistic band");
  });

  it("GST placeholder matches ATO 10% rate", () => {
    const amount = 2_200;
    const ato = amount * 0.1;
    const placeholder = calculateGst({ saleAmount: amount, exempt: false });
    assert.strictEqual(placeholder, ato);
    const exempt = calculateGst({ saleAmount: amount, exempt: true });
    assert.strictEqual(exempt, 0);
  });

  it("Penalty placeholder is softer than ATO guidance", () => {
    const daysLate = 30;
    const amountDue = 10_000;
    const ato = atoPenalty(daysLate, amountDue);
    const placeholder = calculatePenalties(daysLate, amountDue);
    assert.ok(placeholder < ato, "placeholder penalties should be less aggressive");
    assert.ok(placeholder > 0, "penalties should remain positive when overdue");
  });
});
