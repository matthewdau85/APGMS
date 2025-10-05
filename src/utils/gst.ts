import { GstInput } from "../types/tax";
import { GST_RATES } from "../data/atoTables";

function resolveRate(exempt: boolean | undefined, taxCode?: string): number {
  if (exempt) return 0;
  const code = (taxCode ?? (exempt ? "GST_FREE" : "GST")).toUpperCase();
  return GST_RATES[code]?.rate ?? 0;
}

export function calculateGst({ saleAmount, exempt = false, taxCode }: GstInput): number {
  if (saleAmount <= 0) {
    return 0;
  }
  const rate = resolveRate(exempt, taxCode);
  return saleAmount * rate;
}
