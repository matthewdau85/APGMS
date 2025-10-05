import { schedules } from "../tax";

export function calculatePenalties(daysLate: number, amountDue: number): number {
  const liabilityCents = Math.round(amountDue * 100);
  const penaltyCents = schedules.penalty(liabilityCents, daysLate);
  return penaltyCents / 100;
}
