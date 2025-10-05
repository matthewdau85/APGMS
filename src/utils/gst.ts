import paygRules from "../../apps/services/tax-engine/app/rules/payg_w_2024_25.json";
import { GstInput } from "../types/tax";

const gstRules = paygRules.gst ?? { rate: 0.1, purchase_offsets: {} };

function roundCurrency(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function calculateGst({ saleAmount, exempt = false, purchases = [] }: GstInput): number {
  if (exempt || saleAmount <= 0) return 0;
  const rate = gstRules.rate ?? 0;
  const saleTax = roundCurrency(saleAmount * rate);
  const offsets = gstRules.purchase_offsets ?? {};
  const credits = purchases.reduce((total, purchase) => {
    const code = (purchase.taxCode ?? "GST").toUpperCase();
    const offsetRate = offsets[code as keyof typeof offsets] ?? 0;
    return total + roundCurrency((purchase.amount ?? 0) * offsetRate);
  }, 0);
  return roundCurrency(saleTax - credits);
}
