import { calcPenalty, getActiveRatesVersionId } from "../domain/tax";
import { DEFAULT_RATES_VERSION_ID } from "../domain/defaultRates";

function dollarsToCents(amount: number): number {
  if (!Number.isFinite(amount)) return 0;
  return Math.round(amount * 100);
}

export function calculatePenalties(daysLate: number, amountDue: number, versionId?: string): number {
  if (!Number.isFinite(daysLate) || daysLate <= 0) return 0;
  const amountCents = dollarsToCents(amountDue);
  if (amountCents <= 0) return 0;
  const resolvedVersion = versionId ?? getActiveRatesVersionId() ?? DEFAULT_RATES_VERSION_ID;
  const penaltyCents = calcPenalty(daysLate, amountCents, resolvedVersion);
  return penaltyCents / 100;
}
