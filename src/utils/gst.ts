import { GstInput } from "../types/tax";

export function calculateGst({ saleAmount, exempt = false }: GstInput): number {
  if (exempt) return 0;
  return saleAmount * 0.1;
}
