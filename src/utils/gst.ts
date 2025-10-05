import { schedules } from "../tax";
import { GstInput } from "../types/tax";

export function calculateGst({ saleAmount, exempt = false }: GstInput): number {
  if (exempt) return 0;
  const taxableCents = Math.round(saleAmount * 100);
  const gstCents = schedules.gst(taxableCents);
  return gstCents / 100;
}
