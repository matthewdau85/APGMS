import { schedules } from "../tax";

export function calculatePenalties(daysLate: number, amountDue: number): number {
  const penaltyCents = schedules.penalty(Math.round(amountDue * 100), daysLate);
  return penaltyCents / 100;
}
