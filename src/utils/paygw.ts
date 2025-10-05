import { PaygwInput } from "../types/tax";

type PayPeriod = PaygwInput["period"];

type PeriodConfig = {
  periodsPerYear: number;
};

const PERIOD_CONFIG: Record<PayPeriod, PeriodConfig> = {
  weekly: { periodsPerYear: 52 },
  fortnightly: { periodsPerYear: 26 },
  monthly: { periodsPerYear: 12 },
  quarterly: { periodsPerYear: 4 },
};

export type PaygwScheduleMetadata = {
  version: string;
  effectiveFrom: string;
  source: string;
};

const SCHEDULE_METADATA: PaygwScheduleMetadata = {
  version: "Schedule 1 (NAT 1004)",
  effectiveFrom: "2024-07-01",
  source: "ATO PAYG withholding tax tables",
};

const STAGE_3_THRESHOLDS = [0, 18_200, 45_000, 135_000, 190_000];
const STAGE_3_RATES = [0, 0.19, 0.30, 0.37, 0.45];
const STAGE_3_BASE_TAX = [0, 0, 5_092, 32_192, 52_927];

function computeAnnualTax(income: number): number {
  if (income <= STAGE_3_THRESHOLDS[1]) {
    return 0;
  }

  if (income <= STAGE_3_THRESHOLDS[2]) {
    return (income - STAGE_3_THRESHOLDS[1]) * STAGE_3_RATES[1];
  }

  if (income <= STAGE_3_THRESHOLDS[3]) {
    return (
      STAGE_3_BASE_TAX[2] +
      (income - STAGE_3_THRESHOLDS[2]) * STAGE_3_RATES[2]
    );
  }

  if (income <= STAGE_3_THRESHOLDS[4]) {
    return (
      STAGE_3_BASE_TAX[3] +
      (income - STAGE_3_THRESHOLDS[3]) * STAGE_3_RATES[3]
    );
  }

  return (
    STAGE_3_BASE_TAX[4] + (income - STAGE_3_THRESHOLDS[4]) * STAGE_3_RATES[4]
  );
}

function computeLowIncomeTaxOffset(income: number): number {
  if (income <= 37_000) {
    return 700;
  }

  if (income <= 45_000) {
    return 700 - 0.05 * (income - 37_000);
  }

  if (income <= 66_667) {
    return Math.max(0, 325 - 0.015 * (income - 45_000));
  }

  return 0;
}

function computeMedicareLevy(income: number): number {
  if (income <= 26_000) {
    return 0;
  }

  if (income <= 32_500) {
    return (income - 26_000) * 0.1;
  }

  return income * 0.02;
}

function roundToCents(value: number): number {
  return Math.round(value * 100) / 100;
}

function computeExpectedWithholding(
  taxableEarnings: number,
  period: PayPeriod,
): number {
  const multiplier = PERIOD_CONFIG[period].periodsPerYear;
  const annualTaxable = Math.max(taxableEarnings, 0) * multiplier;
  const grossTax = computeAnnualTax(annualTaxable);
  const medicareLevy = computeMedicareLevy(annualTaxable);
  const lito = computeLowIncomeTaxOffset(annualTaxable);
  const annualLiability = Math.max(0, grossTax + medicareLevy - lito);
  return roundToCents(annualLiability / multiplier);
}

export function calculateScheduledWithholding(
  grossIncome: number,
  period: PayPeriod,
  deductions = 0,
): number {
  const taxableEarnings = grossIncome - deductions;
  return computeExpectedWithholding(taxableEarnings, period);
}

export function calculatePaygw({
  grossIncome,
  taxWithheld,
  period,
  deductions = 0,
}: PaygwInput): number {
  const expectedWithholding = calculateScheduledWithholding(
    grossIncome,
    period,
    deductions,
  );
  const outstanding = expectedWithholding - taxWithheld;
  return Math.max(roundToCents(outstanding), 0);
}

export function getPaygwScheduleMetadata(): PaygwScheduleMetadata {
  return SCHEDULE_METADATA;
}
