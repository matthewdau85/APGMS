import { PaygwInput } from "../types/tax";
import { schedules } from "../tax";

export function calculatePaygw({ grossIncome, taxWithheld, period, deductions = 0 }: PaygwInput): number {
  const taxableAmount = Math.max(0, grossIncome - deductions);
  const taxWithheldCents = Math.round(taxWithheld * 100);

  if (period === "quarterly") {
    const monthlyTaxableCents = Math.round((taxableAmount / 3) * 100);
    const monthlyLiabilityCents = schedules.paygw(monthlyTaxableCents, "monthly");
    const quarterlyLiabilityCents = monthlyLiabilityCents * 3;
    const quarterlyNetCents = quarterlyLiabilityCents - taxWithheldCents;
    return Math.max(0, quarterlyNetCents) / 100;
  }

  const taxableCents = Math.round(taxableAmount * 100);
  const liabilityCents = schedules.paygw(taxableCents, period);
  const netCents = liabilityCents - taxWithheldCents;
  return Math.max(0, netCents) / 100;
}
