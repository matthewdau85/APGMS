export { AnomalyVector, Thresholds, isAnomalous as isVectorAnomalous } from "./deterministic";

/**
 * Determines whether the observed delta exceeds the expected tolerance.
 *
 * @param deltaCents Difference between observed and expected values in cents.
 * @param expectedCents Expected value in cents.
 * @param toleranceBps Allowed tolerance expressed in basis points (1/100th of a percent).
 */
export function isAnomalous(deltaCents: number, expectedCents: number, toleranceBps: number): boolean {
  if (!Number.isFinite(deltaCents) || !Number.isFinite(expectedCents) || !Number.isFinite(toleranceBps)) {
    throw new Error("INVALID_ANOMALY_INPUT");
  }

  const basis = Math.abs(expectedCents);
  const tolerance = (Math.max(toleranceBps, 0) / 10_000) * basis;

  if (basis === 0) {
    return Math.abs(deltaCents) > 0;
  }

  return Math.abs(deltaCents) > tolerance;
}
