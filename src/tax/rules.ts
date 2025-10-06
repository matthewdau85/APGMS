import paygJson from "../../apps/services/tax-engine/app/rules/payg_w_2024_25.json";
import gstJson from "../../apps/services/tax-engine/app/rules/gst_rules_2024_25.json";

type PayPeriod = "weekly" | "fortnightly" | "monthly";

type LinearBracket = {
  min: number;
  max: number;
  type: "linear";
  rate: number;
  offset: number;
};

type NoneBracket = {
  min: number;
  max: number;
  type: "none";
};

type PaygwBracket = LinearBracket | NoneBracket;

type PaygwFlags = {
  taxFreeThreshold?: boolean;
  roundingMode?: "HALF_UP" | "DOWN" | "UP";
};

type PaygwPeriodRules = {
  tax_free_threshold: PaygwBracket[];
  no_tax_free_threshold: PaygwBracket[];
};

type PaygwRuleset = {
  version: string;
  effective_from: string;
  effective_to: string;
  rounding: "HALF_UP";
  periods: Record<PayPeriod, PaygwPeriodRules>;
};

type GstTaxCodeRule = {
  rate: number;
  description: string;
};

type GstRuleset = {
  version: string;
  effective_from: string;
  effective_to: string;
  rounding: "HALF_UP";
  sales_tax_codes: Record<string, GstTaxCodeRule>;
  purchase_tax_codes: Record<string, GstTaxCodeRule>;
};

export type PaygwComputation = {
  withheld: number;
  ratesVersion: string;
  effectiveFrom: string;
  effectiveTo: string;
};

export type GstSaleLine = {
  transactionId: string;
  type: "sale" | "refund";
  total: number;
  taxableAmount?: number;
  gstAmount?: number;
  taxCode: string;
};

export type GstPurchaseLine = {
  purchaseId: string;
  total: number;
  gstAmount?: number;
  taxCode: string;
  category: "capital" | "non_capital";
};

export type GstBasket = {
  sales: GstSaleLine[];
  purchases: GstPurchaseLine[];
};

export type GstAdjustments = Partial<{
  salesAdjustments: number;
  gstOnSalesAdjustments: number;
  capitalPurchasesAdjustments: number;
  nonCapitalPurchasesAdjustments: number;
  gstOnPurchasesAdjustments: number;
}>;

export type GstComputation = {
  totals: {
    G1: number;
    "1A": number;
    G10: number;
    G11: number;
    "1B": number;
  };
  ratesVersion: string;
  effectiveFrom: string;
  effectiveTo: string;
};

const paygRules = paygJson as PaygwRuleset;
const gstRules = gstJson as GstRuleset;

const HALF_CENT = 0.0000001;

function roundAmount(amount: number, mode: "HALF_UP" | "DOWN" | "UP" = "HALF_UP"): number {
  switch (mode) {
    case "DOWN":
      return Math.floor(amount * 100 + HALF_CENT) / 100;
    case "UP":
      return Math.ceil(amount * 100 - HALF_CENT) / 100;
    default:
      return roundHalfUp(amount);
  }
}

// Custom HALF_UP round to cents
function roundHalfUp(amount: number): number {
  const scaled = Math.round((amount + Number.EPSILON) * 100);
  return scaled / 100;
}

export function getPaygw(period: PayPeriod, gross: number, flags: PaygwFlags = {}): PaygwComputation {
  const rules = paygRules.periods[period];
  if (!rules) {
    throw new Error(`Unsupported period ${period}`);
  }
  const table = flags.taxFreeThreshold === false ? rules.no_tax_free_threshold : rules.tax_free_threshold;
  const roundingMode = flags.roundingMode ?? paygRules.rounding;
  let bracket = table.find(entry => gross >= entry.min && gross < entry.max);
  if (!bracket) {
    bracket = table[table.length - 1];
  }

  let withheld = 0;
  if (bracket.type === "linear") {
    withheld = gross * bracket.rate - bracket.offset;
    if (withheld < 0) withheld = 0;
  }

  const rounded = roundingMode === "HALF_UP" ? roundHalfUp(withheld) : roundAmount(withheld, roundingMode);

  return {
    withheld: rounded,
    ratesVersion: paygRules.version,
    effectiveFrom: paygRules.effective_from,
    effectiveTo: paygRules.effective_to,
  };
}

export function getGst(basket: GstBasket, _basis: "cash" | "accrual", adjustments: GstAdjustments = {}): GstComputation {
  let g1 = 0;
  let g10 = 0;
  let g11 = 0;
  let oneA = 0;
  let oneB = 0;

  for (const line of basket.sales) {
    const sign = line.type === "refund" ? -1 : 1;
    const total = roundHalfUp((line.total ?? 0) * sign);
    const taxCode = gstRules.sales_tax_codes[line.taxCode];
    const rate = taxCode?.rate ?? 0;
    const gstAmount = line.gstAmount ?? roundHalfUp((line.taxableAmount ?? line.total ?? 0) * rate);

    g1 += total;
    oneA += roundHalfUp(gstAmount * sign);
  }

  for (const purchase of basket.purchases) {
    const total = roundHalfUp(purchase.total ?? 0);
    const gstAmount = purchase.gstAmount ?? roundHalfUp(total * (gstRules.purchase_tax_codes[purchase.taxCode]?.rate ?? 0));
    if (purchase.category === "capital") {
      g10 += total;
    } else {
      g11 += total;
    }
    oneB += roundHalfUp(gstAmount);
  }

  g1 += roundHalfUp(adjustments.salesAdjustments ?? 0);
  oneA += roundHalfUp(adjustments.gstOnSalesAdjustments ?? 0);
  g10 += roundHalfUp(adjustments.capitalPurchasesAdjustments ?? 0);
  g11 += roundHalfUp(adjustments.nonCapitalPurchasesAdjustments ?? 0);
  oneB += roundHalfUp(adjustments.gstOnPurchasesAdjustments ?? 0);

  return {
    totals: {
      G1: roundHalfUp(g1),
      "1A": roundHalfUp(oneA),
      G10: roundHalfUp(g10),
      G11: roundHalfUp(g11),
      "1B": roundHalfUp(oneB),
    },
    ratesVersion: gstRules.version,
    effectiveFrom: gstRules.effective_from,
    effectiveTo: gstRules.effective_to,
  };
}

export type { PayPeriod, PaygwFlags };
