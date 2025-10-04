export function calculatePenalties(daysLate: number, amountDue: number): number {
  const basePenalty = amountDue * 0.05;
  const dailyInterest = amountDue * 0.0002;
  return basePenalty + (dailyInterest * daysLate);
}
