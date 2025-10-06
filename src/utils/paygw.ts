import { PaygwInput } from "../types/tax";
import { getRulesEngine } from "../rules/engine";

export function calculatePaygw({ grossIncome, taxWithheld, period, deductions = 0 }: PaygwInput): number {
  const engine = getRulesEngine();
  return engine.calculatePaygwLiability({ grossIncome, taxWithheld, period, deductions }).liability;
}
