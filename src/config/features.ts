export const FEATURES = {
  MODE: process.env.APP_MODE ?? "prototype", // prototype | real
  TAX_ENGINE: process.env.FEATURE_TAX_ENGINE === "true",
  ATO_TABLES: process.env.FEATURE_ATO_TABLES === "true",
  BANKING: process.env.FEATURE_BANKING === "true",
  STP: process.env.FEATURE_STP === "true",
  SECURITY_MIN: process.env.FEATURE_SECURITY_MIN !== "false", // default on
  SETTLEMENT_LINK: process.env.FEATURE_SETTLEMENT_LINK === "true",
  DRY_RUN: process.env.DRY_RUN === "true",
  SHADOW_ONLY: process.env.SHADOW_ONLY === "true",
  API_V2: process.env.FEATURE_API_V2 === "true",
};
export const IS_REAL = FEATURES.MODE === "real";
