const flag = process.env.FEATURE_SIM_OUTBOUND;

export const FEATURES = {
  FEATURE_SIM_OUTBOUND: flag === "1" || flag?.toLowerCase() === "true",
} as const;
