import { ATO_RATES, PENALTY_PERIOD_DAYS, type AtoRatesConfig } from "../config/ato";

export type EntitySize = "small" | "medium" | "large" | "significantGlobalEntity";

export type PenaltyBreakdown = {
  /** Failure to lodge on time penalty component. */
  ftlPenalty: number;
  /** General interest charge accrued over the late period. */
  gicInterest: number;
  /** Total penalty amount (FTL + GIC). */
  totalPenalty: number;
  /** Number of 28-day penalty periods applied. */
  penaltyPeriods: number;
};

const ENTITY_PENALTY_MULTIPLIER: Record<EntitySize, number> = {
  small: 1,
  medium: 2,
  large: 5,
  significantGlobalEntity: 15,
};

function roundToCents(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function calculatePenalties(
  daysLate: number,
  amountDue: number,
  entitySize: EntitySize = "small",
  rates: AtoRatesConfig = ATO_RATES,
): PenaltyBreakdown {
  const safeDaysLate = Math.max(0, Math.ceil(daysLate));
  const safeAmountDue = Math.max(0, amountDue);
  const penaltyPeriods = safeDaysLate === 0 ? 0 : Math.ceil(safeDaysLate / PENALTY_PERIOD_DAYS);

  const ftlPenalty = penaltyPeriods * rates.penaltyUnitValue * ENTITY_PENALTY_MULTIPLIER[entitySize];

  const dailyRate = rates.gicAnnualRate / 365;
  const gicInterest = safeDaysLate === 0
    ? 0
    : safeAmountDue * (Math.pow(1 + dailyRate, safeDaysLate) - 1);

  const totalPenalty = ftlPenalty + gicInterest;

  return {
    ftlPenalty: roundToCents(ftlPenalty),
    gicInterest: roundToCents(gicInterest),
    totalPenalty: roundToCents(totalPenalty),
    penaltyPeriods,
  };
}
