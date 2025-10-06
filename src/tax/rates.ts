export type PayPeriod = "weekly" | "fortnightly" | "monthly";

interface ProgressiveBracket {
  up_to: number;
  a: number;
  b: number;
  fixed: number;
}

interface ProgressiveRule {
  version: string;
  brackets: ProgressiveBracket[];
  rounding: "HALF_UP" | "HALF_EVEN";
  tax_free_threshold: boolean;
}

const WEEKLY_RULE: ProgressiveRule = {
  version: "2024-25",
  tax_free_threshold: true,
  rounding: "HALF_UP",
  brackets: [
    { up_to: 359.0,   a: 0.0,   b:   0.0,  fixed: 0.0 },
    { up_to: 438.0,   a: 0.19,  b:  68.0,  fixed: 0.0 },
    { up_to: 548.0,   a: 0.234, b:  87.82, fixed: 0.0 },
    { up_to: 721.0,   a: 0.347, b: 148.50, fixed: 0.0 },
    { up_to: 865.0,   a: 0.345, b: 147.00, fixed: 0.0 },
    { up_to: 999999.0, a: 0.39, b: 183.0,  fixed: 0.0 }
  ]
};

const PERIOD_FACTORS: Record<PayPeriod, number> = {
  weekly: 1,
  fortnightly: 2,
  monthly: 52 / 12
};

function roundHalfUp(value: number, scale = 2): number {
  const factor = Math.pow(10, scale);
  return Math.round(value * factor) / factor;
}

function applyBrackets(grossDollars: number, rules: ProgressiveRule): number {
  for (const bracket of rules.brackets) {
    if (grossDollars <= bracket.up_to) {
      const tax = bracket.a * grossDollars - bracket.b + bracket.fixed;
      return Math.max(0, tax);
    }
  }
  return 0;
}

export function paygwWithholdingCents(
  grossCents: number,
  period: PayPeriod,
  opts?: { taxFreeThreshold?: boolean }
): { withholding_cents: number; rates_version: string } {
  const rules = WEEKLY_RULE;
  const factor = PERIOD_FACTORS[period] ?? 1;
  const taxFreeThreshold = opts?.taxFreeThreshold ?? true;

  const grossWeeklyDollars = (grossCents / 100) / factor;
  let weeklyTaxDollars = applyBrackets(grossWeeklyDollars, rules);

  if (!taxFreeThreshold && rules.tax_free_threshold) {
    // Simple fallback: approximate no-tax-free-threshold by removing the offset component.
    weeklyTaxDollars = Math.max(0, weeklyTaxDollars + (rules.brackets[1]?.b ?? 0));
  }

  const periodTaxDollars = weeklyTaxDollars * factor;
  const rounded = roundHalfUp(periodTaxDollars, 2);
  const withholdingCents = Math.max(0, Math.round(rounded * 100));
  return { withholding_cents: withholdingCents, rates_version: rules.version };
}

export const PAYGW_RULE_VERSION = WEEKLY_RULE.version;
