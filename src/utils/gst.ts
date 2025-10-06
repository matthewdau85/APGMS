import { GstInput } from "../types/tax";
import { calcGST, getActiveRatesVersionId } from "../domain/tax";
import { DEFAULT_RATES_VERSION_ID } from "../domain/defaultRates";

function dollarsToCents(amount: number): number {
  if (!Number.isFinite(amount)) return 0;
  return Math.round(amount * 100);
}

export function calculateGst({ saleAmount, exempt = false }: GstInput, versionId?: string): number {
  if (exempt) return 0;
  const netCents = dollarsToCents(saleAmount);
  if (netCents <= 0) return 0;
  const resolvedVersion = versionId ?? getActiveRatesVersionId() ?? DEFAULT_RATES_VERSION_ID;
  const gstCents = calcGST(netCents, resolvedVersion);
  return gstCents / 100;
}
