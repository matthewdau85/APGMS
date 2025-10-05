import { PaygwInput } from "../types/tax";

const DEFAULT_TAX_ENGINE_URL = "http://localhost:8002";

type PaygwServiceResponse = {
  method: string;
  gross: number;
  withholding: number;
  net: number;
  explain?: string[];
  rules_version?: string;
};

function resolveTaxEngineEndpoint(): string {
  const base = (process.env.NEXT_PUBLIC_TAX_ENGINE_URL ?? DEFAULT_TAX_ENGINE_URL).trim();
  const normalized = base.endsWith("/") ? base.slice(0, -1) : base;
  return `${normalized}/api/paygw`;
}

function normalisePeriod(
  input: PaygwInput,
): { period: "weekly" | "fortnightly" | "monthly"; gross: number; remapMultiplier: number } {
  if (input.period === "quarterly") {
    // Treat quarterly figures as a monthly equivalent for table lookups.
    return { period: "monthly", gross: input.grossIncome / 3, remapMultiplier: 3 };
  }
  return { period: input.period, gross: input.grossIncome, remapMultiplier: 1 };
}

export async function calculatePaygw(input: PaygwInput): Promise<number> {
  const { period, gross, remapMultiplier } = normalisePeriod(input);
  const endpoint = resolveTaxEngineEndpoint();

  const payload = {
    payg_w: {
      method: "table_ato" as const,
      period,
      gross,
      tax_free_threshold: input.taxFreeThreshold ?? true,
      stsl: input.stsl ?? false,
      medicare_variation: input.medicareVariation ?? "standard",
    },
  };

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Unable to calculate PAYG withholding (tax-engine responded with ${response.status})`);
  }

  const data = (await response.json()) as PaygwServiceResponse;
  const withholdingPerPeriod = typeof data.withholding === "number" ? data.withholding : 0;
  const withholding = withholdingPerPeriod * remapMultiplier;
  const deductions = input.deductions ?? 0;
  const alreadyWithheld = input.taxWithheld ?? 0;
  const liability = withholding - alreadyWithheld - deductions;
  return Math.max(Number(liability.toFixed(2)), 0);
}
