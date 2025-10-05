import { PaygwInput } from "../types/tax";
import {
  PAYG_PERIOD_FACTORS,
  PAYG_BRACKETS_TFT,
  PAYG_BRACKETS_NO_TFT,
  LITO_TIERS,
  MEDICARE_LEVY,
  STSL_THRESHOLDS,
} from "../data/atoTables";

type Bracket = typeof PAYG_BRACKETS_TFT[number];

const DEFAULT_TFT = true;

function progressiveTax(annualIncome: number, brackets: Bracket[]): number {
  for (const br of brackets) {
    if (annualIncome <= br.max) {
      return Math.max(0, br.base + (annualIncome - br.min) * br.rate);
    }
  }
  const last = brackets[brackets.length - 1];
  return Math.max(0, last.base + (annualIncome - last.min) * last.rate);
}

function lito(annualIncome: number): number {
  for (const tier of LITO_TIERS) {
    if (annualIncome <= tier.max) {
      if (!tier.taper) return tier.baseAmount;
      const reduction = (annualIncome - tier.min) * tier.taper;
      return Math.max(0, tier.baseAmount - reduction);
    }
  }
  return 0;
}

function medicareLevy(annualIncome: number): number {
  if (annualIncome <= MEDICARE_LEVY.lowerThreshold) return 0;
  if (annualIncome <= MEDICARE_LEVY.upperThreshold) {
    return (annualIncome - MEDICARE_LEVY.lowerThreshold) * MEDICARE_LEVY.phaseInRate;
  }
  return annualIncome * MEDICARE_LEVY.levyRate;
}

function stslRepayment(annualIncome: number): number {
  let rate = 0;
  for (const threshold of STSL_THRESHOLDS) {
    if (annualIncome >= threshold.min) {
      rate = threshold.rate;
    } else {
      break;
    }
  }
  return annualIncome * rate;
}

function annualWithholding(
  grossIncome: number,
  period: PaygwInput["period"],
  taxFreeThreshold: boolean,
  stsl: boolean,
): number {
  const periodCfg = PAYG_PERIOD_FACTORS[period];
  const periodsPerYear = periodCfg?.periodsPerYear ?? 52;
  const annualIncome = grossIncome * periodsPerYear;
  const brackets = taxFreeThreshold ? PAYG_BRACKETS_TFT : PAYG_BRACKETS_NO_TFT;
  const baseTax = progressiveTax(annualIncome, brackets);
  const litoAmount = taxFreeThreshold ? lito(annualIncome) : 0;
  const medicare = medicareLevy(annualIncome);
  const stslAmount = stsl ? stslRepayment(annualIncome) : 0;
  return Math.max(0, baseTax - litoAmount + medicare + stslAmount);
}

export function calculatePaygw({
  grossIncome,
  taxWithheld,
  period,
  deductions = 0,
  taxFreeThreshold = DEFAULT_TFT,
  stsl = false,
}: PaygwInput): number {
  const periodCfg = PAYG_PERIOD_FACTORS[period];
  const periodsPerYear = periodCfg?.periodsPerYear ?? 52;
  const annual = annualWithholding(grossIncome, period, taxFreeThreshold, stsl);
  const expectedPerPeriod = annual / periodsPerYear;
  const liability = expectedPerPeriod - deductions - taxWithheld;
  return Math.max(Number.isFinite(liability) ? liability : 0, 0);
}
