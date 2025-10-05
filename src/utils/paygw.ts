import { PaygwInput } from "../types/tax";
import { calcPAYGW, getActiveRatesVersionId } from "../domain/tax";
import { DEFAULT_RATES_VERSION_ID } from "../domain/defaultRates";

const PERIODS_PER_YEAR: Record<PaygwInput["period"], number> = {
  weekly: 52,
  fortnightly: 26,
  monthly: 12,
  quarterly: 4,
};

function dollarsToCents(amount: number): number {
  if (!Number.isFinite(amount)) return 0;
  return Math.round(amount * 100);
}

export function calculatePaygw(
  { grossIncome, taxWithheld, period, deductions = 0 }: PaygwInput,
  versionId?: string
): number {
  const periods = PERIODS_PER_YEAR[period];
  const grossCents = dollarsToCents(grossIncome);
  if (grossCents <= 0 || periods <= 0) {
    return 0;
  }
  const annualGross = grossCents * periods;
  const resolvedVersion = versionId ?? getActiveRatesVersionId() ?? DEFAULT_RATES_VERSION_ID;
  const annualWithholdingCents = calcPAYGW(annualGross, resolvedVersion);
  const perPeriodWithholding = Math.round(annualWithholdingCents / periods);

  const deductionsCents = dollarsToCents(deductions);
  const alreadyWithheldCents = dollarsToCents(taxWithheld);
  const liabilityCents = Math.max(perPeriodWithholding - deductionsCents - alreadyWithheldCents, 0);
  return liabilityCents / 100;
}
