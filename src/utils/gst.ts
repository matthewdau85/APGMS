import { GstInput } from "../types/tax";
import { getRulesEngine } from "../rules/engine";

export function calculateGst({ saleAmount, exempt = false }: GstInput): number {
  const engine = getRulesEngine();
  return engine.calculateGstLiability({ saleAmount, exempt }).liability;
}
