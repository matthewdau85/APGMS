import { TaxEngine } from "../../libs/taxEngineClient";
import { PaygwInput } from "../types/tax";

const PERIOD_MAP: Record<PaygwInput["period"], string> = {
  weekly: "weekly",
  fortnightly: "fortnightly",
  monthly: "monthly",
  quarterly: "monthly",
};

export async function calculatePaygw({ grossIncome, taxWithheld, period, deductions = 0 }: PaygwInput): Promise<number> {
  const grossCents = Math.round(Math.max(grossIncome, 0) * 100);
  const withheldCents = Math.round(Math.max(taxWithheld, 0) * 100);
  const deductionCents = Math.round(Math.max(deductions, 0) * 100);
  const schedule = PERIOD_MAP[period] ?? "weekly";

  const { withholding_cents } = await TaxEngine.computeWithholding({
    gross: grossCents,
    period: schedule,
    flags: { tax_free_threshold: true },
  });

  const liabilityCents = Math.max(withholding_cents - withheldCents - deductionCents, 0);
  return liabilityCents / 100;
}
