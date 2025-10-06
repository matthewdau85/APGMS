import { PaygwInput } from "../types/tax";
import { getPaygwSchedule, roundCurrency } from "../tax/atoSchedules";

export function calculatePaygw({ grossIncome, taxWithheld, period, deductions = 0 }: PaygwInput): number {
  const schedule = getPaygwSchedule();
  const frequency = schedule.frequencies[period];
  if (!frequency) {
    throw new Error(`Unsupported pay frequency: ${period}`);
  }

  const bracket = frequency.brackets.find((entry) => {
    const upperBound = entry.max ?? Number.POSITIVE_INFINITY;
    return grossIncome >= entry.min && grossIncome <= upperBound;
  }) ?? frequency.brackets[frequency.brackets.length - 1];

  const taxablePortion = Math.max(0, grossIncome - bracket.min);
  let liability = bracket.base + taxablePortion * bracket.rate;

  if (bracket.offset) {
    liability -= bracket.offset;
  }

  if (frequency.medicareLevy) {
    const { lowerThreshold, upperThreshold, fullRate, phaseInRate } = frequency.medicareLevy;
    if (grossIncome > upperThreshold) {
      liability += grossIncome * fullRate;
    } else if (grossIncome > lowerThreshold) {
      liability += (grossIncome - lowerThreshold) * phaseInRate;
    }
  }

  liability -= deductions;
  liability -= taxWithheld;

  const rounded = roundCurrency(Math.max(liability, 0), frequency.rounding);
  return rounded;
}
