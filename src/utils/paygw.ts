import { schedules } from "../tax";
import { PaygwInput } from "../types/tax";

const FREQUENCY_MAP: Record<PaygwInput["period"], { frequency: "weekly" | "fortnightly" | "monthly"; multiplier: number }> = {
  weekly: { frequency: "weekly", multiplier: 1 },
  fortnightly: { frequency: "fortnightly", multiplier: 1 },
  monthly: { frequency: "monthly", multiplier: 1 },
  quarterly: { frequency: "monthly", multiplier: 3 },
};

export function calculatePaygw({ grossIncome, taxWithheld, period, deductions = 0 }: PaygwInput): number {
  const { frequency, multiplier } = FREQUENCY_MAP[period];
  const taxableTotal = Math.max(grossIncome - deductions, 0);
  const taxablePerPeriod = taxableTotal / multiplier;
  const taxableCents = Math.round(taxablePerPeriod * 100);
  const expectedPerPeriodCents = schedules.paygw(taxableCents, frequency);
  const expectedTotalCents = expectedPerPeriodCents * multiplier;
  const withheldCents = Math.round(taxWithheld * 100);
  const liabilityCents = Math.max(expectedTotalCents - withheldCents, 0);
  return liabilityCents / 100;
}
