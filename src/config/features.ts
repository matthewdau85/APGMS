const coerceBoolean = (value?: string): boolean => {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
};

export const APP_MODE = (process.env.APP_MODE ?? "production").trim();
export const FEATURE_BANKING = coerceBoolean(process.env.FEATURE_BANKING);
export const FEATURE_STP = coerceBoolean(process.env.FEATURE_STP);
export const FEATURE_POS = coerceBoolean(process.env.FEATURE_POS);
export const FEATURE_SECURITY_MIN = coerceBoolean(process.env.FEATURE_SECURITY_MIN);
export const RATES_VERSION = (process.env.RATES_VERSION ?? "latest").trim();

export const FEATURES = {
  APP_MODE,
  FEATURE_BANKING,
  FEATURE_STP,
  FEATURE_POS,
  FEATURE_SECURITY_MIN,
  RATES_VERSION,
} as const;

export type Features = typeof FEATURES;

export default FEATURES;
