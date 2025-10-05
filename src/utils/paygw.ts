import { PaygwInput } from "../types/tax";

export type PaygwBreakdown = {
  /** Annualised earnings used to align with the ATO withholding schedule. */
  annualisedIncome: number;
  /** Amount that should be withheld for the selected period. */
  requiredWithholding: number;
  /** Amount that has already been withheld from payroll. */
  amountAlreadyWithheld: number;
  /** Additional deductions or offsets applied this period. */
  deductionsApplied: number;
  /** Residual liability payable to the ATO (never negative). */
  shortfall: number;
};

const PERIODS_PER_YEAR: Record<PaygwInput["period"], number> = {
  weekly: 52,
  fortnightly: 26,
  monthly: 12,
  quarterly: 4,
};

function roundCurrency(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function calculateAnnualTax(taxableIncome: number): number {
  if (taxableIncome <= 18_200) {
    return 0;
  }
  if (taxableIncome <= 45_000) {
    return (taxableIncome - 18_200) * 0.16;
  }
  if (taxableIncome <= 135_000) {
    return 4_288 + (taxableIncome - 45_000) * 0.3;
  }
  if (taxableIncome <= 190_000) {
    return 31_288 + (taxableIncome - 135_000) * 0.37;
  }
  return 51_638 + (taxableIncome - 190_000) * 0.45;
}

/**
 * Mirrors the 2024–25 ATO withholding schedule by annualising earnings before
 * applying the progressive tax rates published in "Individual income tax rates
 * 2024–25" (ATO QC 102601) and the accompanying "Statement of formulas for
 * calculating amounts to be withheld" NAT 1004 (effective 1 July 2024). These
 * sources prescribe annual thresholds which we convert back to the nominated
 * pay period after rounding to the nearest cent.
 */
export function calculatePaygw({ grossIncome, taxWithheld, period, deductions = 0 }: PaygwInput): PaygwBreakdown {
  const periodsPerYear = PERIODS_PER_YEAR[period];
  const annualisedIncome = grossIncome * periodsPerYear;
  const annualTax = calculateAnnualTax(annualisedIncome);
  const requiredWithholding = roundCurrency(annualTax / periodsPerYear);
  const alreadyWithheld = roundCurrency(taxWithheld);
  const deductionsApplied = roundCurrency(deductions);

  const rawShortfall = requiredWithholding - alreadyWithheld - deductionsApplied;
  const shortfall = rawShortfall > 0 ? roundCurrency(rawShortfall) : 0;

  return {
    annualisedIncome: roundCurrency(annualisedIncome),
    requiredWithholding,
    amountAlreadyWithheld: alreadyWithheld,
    deductionsApplied,
    shortfall,
  };
}
