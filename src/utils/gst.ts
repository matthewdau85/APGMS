import { GstInput } from "../types/tax";

export type GstBreakdown = {
  taxableAmount: number;
  gstPayable: number;
  isExempt: boolean;
};

function roundCurrency(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Implements the GST inclusive price split per "Calculating GST" (ATO QC 22088)
 * where the tax component of an amount that already includes GST is equal to
 * one eleventh of the consideration. Results are rounded to the nearest cent in
 * line with ATO guidance.
 */
export function calculateGst({ saleAmount, exempt = false }: GstInput): GstBreakdown {
  if (exempt) {
    return { taxableAmount: roundCurrency(saleAmount), gstPayable: 0, isExempt: true };
  }

  const gstPayable = roundCurrency(saleAmount / 11);
  const taxableAmount = roundCurrency(saleAmount - gstPayable);

  return { taxableAmount, gstPayable, isExempt: false };
}
