export type AtoRatesConfig = {
  /**
   * Current penalty unit amount in Australian dollars.
   * Source: ATO "Penalty unit values" (effective 1 July 2024).
   */
  penaltyUnitValue: number;
  /**
   * Annual General Interest Charge rate expressed as a decimal (e.g. 0.1134 = 11.34%).
   * Source: ATO "General interest charge (GIC) rates" for the current quarter.
   */
  gicAnnualRate: number;
};

export const ATO_RATES: AtoRatesConfig = {
  penaltyUnitValue: 330,
  gicAnnualRate: 0.1134,
};

export const PENALTY_PERIOD_DAYS = 28;
