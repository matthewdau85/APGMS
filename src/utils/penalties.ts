import { getPenaltySchedule, roundCurrency } from "../tax/atoSchedules";

export function calculatePenalties(daysLate: number, amountDue: number): number {
  if (daysLate <= 0) {
    return 0;
  }

  const schedule = getPenaltySchedule();
  const gracePeriod = schedule.gracePeriodDays ?? 0;
  const effectiveDays = Math.max(0, daysLate - gracePeriod);
  if (effectiveDays === 0) {
    return 0;
  }

  const tier = schedule.tiers.find((entry) => {
    const lower = entry.minDays;
    const upper = entry.maxDays ?? Number.POSITIVE_INFINITY;
    return effectiveDays >= lower && effectiveDays <= upper;
  }) ?? schedule.tiers[schedule.tiers.length - 1];

  const penaltyBase = tier.units * schedule.penaltyUnitAmount;
  const interestRate = schedule.interest.rate;
  const interest = Math.max(amountDue, 0) * interestRate * (effectiveDays / 365);

  const total = penaltyBase + interest;
  return roundCurrency(total, schedule.interest.rounding);
}
