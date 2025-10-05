export type PenaltyBreakdown = {
  generalInterestCharge: number;
  failureToLodgePenalty: number;
  penaltyUnitsApplied: number;
  total: number;
};

function roundCurrency(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

const DAYS_PER_PENALTY_PERIOD = 28;
const PENALTY_UNIT_AMOUNT = 330; // ATO penalty unit from 1 July 2024 (ATO QC 18146)
const ENTITY_MULTIPLIERS: Record<"small" | "medium" | "large", number> = {
  small: 1,
  medium: 2,
  large: 5,
};
const GIC_ANNUAL_RATE = 0.1134; // General interest charge rate for Q1 2025 (ATO QC 52225)

/**
 * Calculates the combined general interest charge (daily compounding) and the
 * failure to lodge on time (FTL) penalty. Both rules are sourced from the ATO's
 * "Failure to lodge on time penalties" guidance (QC 18146) and "General
 * interest charge (GIC) rates" (QC 52225). The entity size determines the
 * multiplier applied to the base penalty unit.
 */
export function calculatePenalties(
  daysLate: number,
  amountDue: number,
  entitySize: "small" | "medium" | "large" = "small"
): PenaltyBreakdown {
  if (daysLate <= 0 || amountDue <= 0) {
    return { generalInterestCharge: 0, failureToLodgePenalty: 0, penaltyUnitsApplied: 0, total: 0 };
  }

  const periodsLate = Math.ceil(daysLate / DAYS_PER_PENALTY_PERIOD);
  const penaltyUnits = periodsLate * ENTITY_MULTIPLIERS[entitySize];
  const failureToLodgePenalty = roundCurrency(penaltyUnits * PENALTY_UNIT_AMOUNT);

  const dailyRate = GIC_ANNUAL_RATE / 365;
  const generalInterestCharge = roundCurrency(amountDue * (Math.pow(1 + dailyRate, daysLate) - 1));

  const total = roundCurrency(generalInterestCharge + failureToLodgePenalty);

  return { generalInterestCharge, failureToLodgePenalty, penaltyUnitsApplied: penaltyUnits, total };
}
