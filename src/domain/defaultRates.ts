import type { PaygwBracket, PenaltyConfig } from "./tax";
import { registerRatesVersion, setActiveRatesVersion } from "./tax";

export const DEFAULT_RATES_VERSION_ID = "f02f0c33-57d2-4bb9-a2bd-6a5f5f7e6d4c";

export const DEFAULT_PAYGW_BRACKETS: PaygwBracket[] = [
  { minCents: 0, maxCents: 1_820_000, baseTaxCents: 0, rateBasisPoints: 0 },
  { minCents: 1_820_001, maxCents: 4_500_000, baseTaxCents: 0, rateBasisPoints: 1_900 },
  { minCents: 4_500_001, maxCents: 12_000_000, baseTaxCents: 509_200, rateBasisPoints: 3_250 },
  { minCents: 12_000_001, maxCents: 18_000_000, baseTaxCents: 2_946_700, rateBasisPoints: 3_700 },
  { minCents: 18_000_001, maxCents: null, baseTaxCents: 5_166_700, rateBasisPoints: 4_500 },
];

export const DEFAULT_PENALTY_CONFIG: PenaltyConfig = {
  penaltyUnitCents: 31_300,
  unitMultiplier: 1,
  daysPerUnit: 28,
  maxUnits: 5,
  gicDailyRateBasisPoints: 32,
  gicCapBasisPoints: 7_500,
  totalCapBasisPoints: 25_000,
};

registerRatesVersion(DEFAULT_RATES_VERSION_ID, {
  name: "FY25 resident schedules",
  effectiveFrom: "2024-07-01",
  effectiveTo: null,
  paygwBrackets: DEFAULT_PAYGW_BRACKETS,
  gstRateBasisPoints: 1_000,
  penaltyConfig: DEFAULT_PENALTY_CONFIG,
  checksum: "c984c6398f27f7553b610a8725fce80a2035e21efae2d1ce1273978038ff052e",
});

setActiveRatesVersion(DEFAULT_RATES_VERSION_ID);
