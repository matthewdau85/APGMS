import paygRules from "../../apps/services/tax-engine/app/rules/payg_w_2024_25.json";
import { PaygwInput } from "../types/tax";

type PaygRules = typeof paygRules;
type Period = PaygwInput["period"];

type WithholdingBreakdown = {
  withholding: number;
  components: Record<string, number>;
};

const DEFAULT_ROUNDING = "HALF_UP" as const;

function roundCurrency(value: number, mode: string = DEFAULT_ROUNDING): number {
  if (mode === "HALF_EVEN") {
    const factor = Math.pow(10, 2);
    const n = value * factor;
    const floor = Math.floor(n);
    const diff = n - floor;
    if (diff > 0.5) return Math.round(n) / factor;
    if (diff < 0.5) return floor / factor;
    return (floor % 2 === 0 ? floor : floor + 1) / factor;
  }
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function getPeriodFactor(period: Period): number {
  const periodCfg = (paygRules.periods as PaygRules["periods"])[period];
  return periodCfg?.annual_factor ?? 52;
}

function annualTax(income: number): number {
  let tax = 0;
  for (const bracket of (paygRules.annual_tax?.brackets ?? []).sort((a, b) => a.threshold - b.threshold)) {
    if (income >= bracket.threshold) {
      tax = bracket.base + bracket.rate * (income - bracket.threshold);
    } else {
      break;
    }
  }
  return Math.max(0, tax);
}

function litoOffset(income: number): number {
  for (const seg of paygRules.lito ?? []) {
    if (income <= seg.up_to) {
      return Math.max(0, seg.a * income + seg.b);
    }
  }
  return 0;
}

function stslRate(income: number): number {
  for (const band of paygRules.stsl?.thresholds ?? []) {
    if (income >= band.min && income <= band.max) {
      return band.rate;
    }
  }
  return 0;
}

function computeTableWithholding(
  gross: number,
  period: Period,
  options: { taxFreeThreshold: boolean; stsl: boolean }
): WithholdingBreakdown {
  const factor = getPeriodFactor(period);
  const annualIncome = gross * factor;
  const baseTax = annualTax(annualIncome);

  const taxFreeThreshold = options.taxFreeThreshold;
  const lito = taxFreeThreshold ? litoOffset(annualIncome) : 0;
  let taxAfterOffsets = Math.max(0, baseTax - lito);
  if (!taxFreeThreshold && gross > 0) {
    taxAfterOffsets += paygRules.tax_free_threshold_benefit ?? 0;
  }

  let withholding = factor ? taxAfterOffsets / factor : taxAfterOffsets;
  const components: Record<string, number> = { income_tax: withholding };

  if (options.stsl) {
    const rate = stslRate(annualIncome);
    if (rate > 0) {
      const annualStsl = annualIncome * rate;
      const perPeriodStsl = factor ? annualStsl / factor : annualStsl;
      withholding += perPeriodStsl;
      components.stsl = perPeriodStsl;
    }
  }

  return {
    withholding: roundCurrency(withholding),
    components: Object.fromEntries(Object.entries(components).map(([k, v]) => [k, roundCurrency(v)])),
  };
}

export function calculatePaygw({
  grossIncome,
  taxWithheld,
  period,
  deductions = 0,
  taxFreeThreshold = true,
  stsl = false,
  bonus = 0,
}: PaygwInput): number {
  const base = computeTableWithholding(grossIncome, period, { taxFreeThreshold, stsl });
  let expectedWithholding = base.withholding;
  if (bonus && bonus > 0) {
    const total = computeTableWithholding(grossIncome + bonus, period, { taxFreeThreshold, stsl });
    expectedWithholding = total.withholding;
  }
  const liability = expectedWithholding - taxWithheld - deductions;
  return roundCurrency(Math.max(liability, 0));
}

export function calculatePaygwComponents(input: PaygwInput): WithholdingBreakdown {
  const breakdown = computeTableWithholding(input.grossIncome, input.period, {
    taxFreeThreshold: input.taxFreeThreshold ?? true,
    stsl: input.stsl ?? false,
  });
  if (input.bonus && input.bonus > 0) {
    const total = computeTableWithholding(input.grossIncome + input.bonus, input.period, {
      taxFreeThreshold: input.taxFreeThreshold ?? true,
      stsl: input.stsl ?? false,
    });
    const bonusComponent = roundCurrency(total.withholding - breakdown.withholding);
    breakdown.components.bonus = bonusComponent;
    breakdown.withholding = total.withholding;
  }
  return breakdown;
}
