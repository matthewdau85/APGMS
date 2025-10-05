export type PayPeriod = "weekly" | "fortnightly" | "monthly" | "quarterly";

export const PAYG_PERIOD_FACTORS: Record<PayPeriod, { periodsPerYear: number }> = {
  weekly: { periodsPerYear: 52 },
  fortnightly: { periodsPerYear: 26 },
  monthly: { periodsPerYear: 12 },
  quarterly: { periodsPerYear: 4 },
};

export type ProgressiveBracket = {
  min: number;
  max: number;
  rate: number;
  base: number;
};

export const PAYG_BRACKETS_TFT: ProgressiveBracket[] = [
  { min: 0, max: 18_200, rate: 0, base: 0 },
  { min: 18_200, max: 45_000, rate: 0.16, base: 0 },
  { min: 45_000, max: 135_000, rate: 0.30, base: 4_288 },
  { min: 135_000, max: 190_000, rate: 0.37, base: 31_288 },
  { min: 190_000, max: Number.POSITIVE_INFINITY, rate: 0.45, base: 51_638 },
];

export const PAYG_BRACKETS_NO_TFT: ProgressiveBracket[] = [
  { min: 0, max: 45_000, rate: 0.16, base: 0 },
  { min: 45_000, max: 135_000, rate: 0.30, base: 7_200 },
  { min: 135_000, max: 190_000, rate: 0.37, base: 34_200 },
  { min: 190_000, max: Number.POSITIVE_INFINITY, rate: 0.45, base: 54_550 },
];

export type LitoTier = {
  min: number;
  max: number;
  baseAmount: number;
  taper?: number;
};

export const LITO_TIERS: LitoTier[] = [
  { min: 0, max: 37_500, baseAmount: 700 },
  { min: 37_500, max: 45_000, baseAmount: 700, taper: 0.05 },
  { min: 45_000, max: 66_667, baseAmount: 325, taper: 0.015 },
];

export type MedicareConfig = {
  lowerThreshold: number;
  upperThreshold: number;
  phaseInRate: number;
  levyRate: number;
};

export const MEDICARE_LEVY: MedicareConfig = {
  lowerThreshold: 26_000,
  upperThreshold: 32_500,
  phaseInRate: 0.1,
  levyRate: 0.02,
};

export type StslThreshold = {
  min: number;
  rate: number;
};

export const STSL_THRESHOLDS: StslThreshold[] = [
  { min: 0, rate: 0 },
  { min: 51_550, rate: 0.01 },
  { min: 59_519, rate: 0.02 },
  { min: 63_090, rate: 0.025 },
  { min: 66_876, rate: 0.03 },
  { min: 70_889, rate: 0.035 },
  { min: 75_141, rate: 0.04 },
  { min: 79_652, rate: 0.045 },
  { min: 84_439, rate: 0.05 },
  { min: 89_520, rate: 0.055 },
  { min: 94_911, rate: 0.06 },
  { min: 100_630, rate: 0.065 },
  { min: 106_699, rate: 0.07 },
  { min: 113_138, rate: 0.075 },
  { min: 119_971, rate: 0.08 },
  { min: 127_220, rate: 0.085 },
  { min: 134_911, rate: 0.09 },
  { min: 143_071, rate: 0.095 },
  { min: 151_735, rate: 0.10 },
];

export type GstRate = {
  rate: number;
  label: string;
};

export const GST_RATES: Record<string, GstRate> = {
  GST: { rate: 0.1, label: "Standard taxable supplies" },
  GST_FREE: { rate: 0, label: "GST-free supplies" },
  INPUT_TAXED: { rate: 0, label: "Input-taxed supplies" },
  EXPORT: { rate: 0, label: "Exports (GST-free)" },
};

export type InterestRatePeriod = {
  start: string;
  end: string;
  gicRate: number;
  sicRate: number;
};

export const INTEREST_RATES: InterestRatePeriod[] = [
  { start: "2024-07-01", end: "2024-09-30", gicRate: 0.1138, sicRate: 0.0838 },
  { start: "2024-10-01", end: "2024-12-31", gicRate: 0.1134, sicRate: 0.0834 },
  { start: "2025-01-01", end: "2025-03-31", gicRate: 0.1116, sicRate: 0.0816 },
  { start: "2025-04-01", end: "2025-06-30", gicRate: 0.109, sicRate: 0.079 },
];
