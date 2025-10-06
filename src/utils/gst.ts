import { TaxEngine } from "../../libs/taxEngineClient";
import { GstInput } from "../types/tax";

export async function calculateGst({ saleAmount, exempt = false }: GstInput): Promise<number> {
  if (exempt) return 0;
  const netCents = Math.round(Math.max(saleAmount, 0) * 100);
  const result = await TaxEngine.computeGST({
    abn: "demo-abn",
    periodId: "on-demand",
    basis: "accrual",
    sales: [{ net_cents: netCents, tax_code: "GST" }],
    purchases: [],
  });
  const gstCents = result.payable?.["1A"] ?? 0;
  return gstCents / 100;
}
