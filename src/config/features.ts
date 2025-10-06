export const FEATURES = {
  FEATURE_SIM_OUTBOUND: String(process.env.FEATURE_SIM_OUTBOUND || "").toLowerCase() === "true",
};

export type Features = typeof FEATURES;
