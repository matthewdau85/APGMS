const DEFAULT_SIGMA_THRESHOLD = 3.0;
const MIN_MATERIALITY_CENTS = 500;

type AnomalyStats = {
  flagged: boolean;
  sigmaThreshold: number;
  materialityThreshold: number;
  deviation: number;
  zScore: number;
};

type EvaluateFn = (
  totalCents: number,
  baselineCents: number,
  sigma?: number,
  materialityCents?: number
) => AnomalyStats;

interface IsAnomalousFn {
  (totalCents: number, baselineCents: number, sigma?: number): boolean;
  evaluate: EvaluateFn;
}

const evaluate: EvaluateFn = (
  totalCents,
  baselineCents,
  sigma = DEFAULT_SIGMA_THRESHOLD,
  materialityCents = MIN_MATERIALITY_CENTS
) => {
  const safeTotal = Number.isFinite(totalCents) ? Number(totalCents) : 0;
  const safeBaseline = Number.isFinite(baselineCents) ? Number(baselineCents) : 0;
  const deviation = Math.abs(safeTotal - safeBaseline);
  const materialityThreshold = Math.max(MIN_MATERIALITY_CENTS, Math.abs(materialityCents));
  if (deviation < materialityThreshold) {
    return {
      flagged: false,
      sigmaThreshold: sigma,
      materialityThreshold,
      deviation,
      zScore: 0
    };
  }

  const varianceBasis = Math.max(Math.abs(safeBaseline), materialityThreshold);
  const stdDev = Math.sqrt(varianceBasis);
  const zScore = stdDev === 0 ? Number.POSITIVE_INFINITY : deviation / stdDev;
  return {
    flagged: zScore >= sigma,
    sigmaThreshold: sigma,
    materialityThreshold,
    deviation,
    zScore
  };
};

export const isAnomalous: IsAnomalousFn = Object.assign(
  (totalCents: number, baselineCents: number, sigma: number = DEFAULT_SIGMA_THRESHOLD) =>
    evaluate(totalCents, baselineCents, sigma).flagged,
  { evaluate }
);
