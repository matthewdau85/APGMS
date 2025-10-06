import { PaygwCalculation, PaygwInput } from "../types/tax";
import {
  describeSchedule,
  getLatestSchedule,
  getScheduleById,
  lowIncomeOffset,
  marginalTax,
  periodsPerYear,
  roundWithholding,
} from "./paygwSchedule";

function resolveSchedule(input: PaygwInput) {
  if (input.scheduleVersion) {
    return getScheduleById(input.scheduleVersion);
  }
  return getLatestSchedule();
}

export function calculatePaygw(input: PaygwInput): PaygwCalculation {
  const schedule = resolveSchedule(input);
  const scheduleMeta = describeSchedule(schedule);
  const perYear = periodsPerYear(input.period, schedule);
  const deductions = input.deductions ?? 0;
  const taxableIncomePerPeriod = Math.max(input.grossIncome - deductions, 0);
  const annualTaxableIncome = taxableIncomePerPeriod * perYear;

  const annualTaxBeforeOffsets = marginalTax(annualTaxableIncome, schedule);
  const lito = lowIncomeOffset(annualTaxableIncome, schedule);
  const annualTaxAfterOffsets = Math.max(annualTaxBeforeOffsets - lito, 0);

  const recommendedWithholding = roundWithholding(annualTaxAfterOffsets / perYear, schedule);
  const outstandingLiability = Math.max(recommendedWithholding - input.taxWithheld, 0);

  return {
    scheduleVersion: scheduleMeta.id,
    effectiveFrom: scheduleMeta.effectiveFrom,
    source: scheduleMeta.source,
    period: input.period,
    grossIncome: input.grossIncome,
    deductions,
    taxableIncomePerPeriod,
    annualTaxableIncome,
    annualTaxBeforeOffsets,
    lowIncomeTaxOffset: lito,
    annualTaxAfterOffsets,
    recommendedWithholding,
    amountAlreadyWithheld: input.taxWithheld,
    outstandingLiability,
    basLabels: {
      W1: Number(input.grossIncome.toFixed(2)),
      W2: recommendedWithholding,
    },
  };
}
