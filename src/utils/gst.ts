import { GstCalculation, GstInput } from "../types/tax";

const GST_DIVISOR = 11;

function roundToCents(amount: number): number {
  return Math.round(amount * 100) / 100;
}

export function calculateGst({ saleAmount, exempt = false, purchaseAmount = 0 }: GstInput): GstCalculation {
  if (exempt) {
    return {
      taxableSales: 0,
      creditablePurchases: 0,
      gstOnSales: 0,
      gstOnPurchases: 0,
      netGst: 0,
      basLabels: { G1: 0, "1A": 0, "1B": 0 },
    };
  }

  const taxableSales = Math.max(saleAmount, 0);
  const creditablePurchases = Math.max(purchaseAmount, 0);

  const gstOnSales = roundToCents(taxableSales / GST_DIVISOR);
  const gstOnPurchases = roundToCents(creditablePurchases / GST_DIVISOR);
  const netGst = roundToCents(gstOnSales - gstOnPurchases);

  return {
    taxableSales: roundToCents(taxableSales),
    creditablePurchases: roundToCents(creditablePurchases),
    gstOnSales,
    gstOnPurchases,
    netGst,
    basLabels: {
      G1: roundToCents(taxableSales),
      "1A": gstOnSales,
      "1B": gstOnPurchases,
    },
  };
}
