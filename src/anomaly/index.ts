export function isAnomalous(deltaCents: number, expectedCents: number, toleranceBps: number): boolean {
  const base = Math.max(1, expectedCents);
  return Math.abs(deltaCents) * 10000 > base * toleranceBps;
}
