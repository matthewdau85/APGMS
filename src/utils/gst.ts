import { GstInput } from "../types/tax";
import { getGstSchedule, roundCurrency } from "../tax/atoSchedules";

export function calculateGst({ saleAmount, exempt = false }: GstInput): number {
  if (exempt) return 0;

  const schedule = getGstSchedule();
  const liability = saleAmount * schedule.standardRate;
  return roundCurrency(liability, schedule.rounding);
}
