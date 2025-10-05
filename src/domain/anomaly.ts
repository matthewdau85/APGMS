export type AnomalyClassification = "CLEAR" | "NEAR" | "BLOCK";

function materialityThreshold(minMateriality: number): number {
  return Math.max(0, minMateriality);
}

function blockThreshold(
  baselineCents: number,
  sigma: number,
  minMateriality: number
): number {
  const baselineMagnitude = Math.max(Math.abs(baselineCents), materialityThreshold(minMateriality));
  const dispersion = Math.max(0, sigma) * Math.sqrt(baselineMagnitude);
  const doubledMateriality = materialityThreshold(minMateriality) * 2;
  return Math.max(dispersion, doubledMateriality || 0);
}

export function isAnomalous(
  totalCents: number,
  baselineCents: number,
  sigma = 3.0,
  minMateriality = 500
): AnomalyClassification {
  const total = Number.isFinite(totalCents) ? totalCents : 0;
  const baseline = Number.isFinite(baselineCents) ? baselineCents : 0;
  const materiality = materialityThreshold(minMateriality);

  const delta = Math.abs(total - baseline);
  if (delta < materiality) {
    return "CLEAR";
  }

  const blockCutoff = blockThreshold(baseline, sigma, minMateriality);
  if (delta >= blockCutoff) {
    return "BLOCK";
  }

  return "NEAR";
}

