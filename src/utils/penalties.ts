import { MoneyCents, expectMoneyCents, fromCents, mulBp, toCents } from "../../libs/money";

const BASE_PENALTY_BP = 500; // 5%
const DAILY_INTEREST_BP = 20; // 0.20%

export function calculatePenalties(daysLate: number, amountDue: MoneyCents | number): MoneyCents {
  const cents = expectMoneyCents(amountDue, "amountDue");
  if (!Number.isInteger(daysLate) || daysLate < 0) {
    throw new Error("daysLate must be a non-negative integer");
  }
  const basePenalty = mulBp(cents, BASE_PENALTY_BP);
  const dailyInterest = mulBp(cents, DAILY_INTEREST_BP);
  const total = toCents(basePenalty) + toCents(dailyInterest) * daysLate;
  return fromCents(total);
}
