import { PaygwInput } from "../types/tax";

export function calculatePaygw({ grossIncome, taxWithheld, period, deductions = 0 }: PaygwInput): number {
  const baseRate = 0.20;
  const liability = grossIncome * baseRate - deductions - taxWithheld;
  return Math.max(liability, 0);
}
