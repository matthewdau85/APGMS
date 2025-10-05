import { PaygwInput } from "../types/tax";
import { postJson } from "./taxEngineClient";

type PaygwResponse = {
  gross: number;
  withholding: number;
  net: number;
  liability: number;
  explain?: string[];
};

export async function calculatePaygw(input: PaygwInput): Promise<number> {
  const payload = {
    payg_w: {
      method: input.method ?? "table_ato",
      period: input.period,
      gross: input.grossIncome,
      tax_free_threshold: input.taxFreeThreshold ?? true,
      stsl: input.stsl ?? false,
    },
    tax_withheld: input.taxWithheld ?? 0,
    deductions: input.deductions ?? 0,
  };

  const result = await postJson<PaygwResponse>("/calculate/payg-w", payload);
  return result.liability ?? 0;
}

export async function calculatePaygwDetail(input: PaygwInput): Promise<PaygwResponse> {
  const payload = {
    payg_w: {
      method: input.method ?? "table_ato",
      period: input.period,
      gross: input.grossIncome,
      tax_free_threshold: input.taxFreeThreshold ?? true,
      stsl: input.stsl ?? false,
      target_net: input.targetNet,
      solver_method: input.solverMethod,
    },
    tax_withheld: input.taxWithheld ?? 0,
    deductions: input.deductions ?? 0,
  };

  return postJson<PaygwResponse>("/calculate/payg-w", payload);
}
