const env = (typeof process !== "undefined" && process.env) ? process.env : {} as Record<string, string | undefined>;

function envBool(key: string, defaultValue: boolean): boolean {
  const raw = env[key];
  if (raw == null) return defaultValue;
  const normalized = raw.trim().toLowerCase();
  if (normalized === "") return defaultValue;
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return defaultValue;
}

export const FEATURES = {
  APP_MODE: (env.APP_MODE ?? "prototype") as "prototype" | "real",
  FEATURE_TAX_ENGINE: envBool("FEATURE_TAX_ENGINE", true),
  FEATURE_ATO_TABLES: envBool("FEATURE_ATO_TABLES", false),
  FEATURE_BANKING: envBool("FEATURE_BANKING", false),
  FEATURE_STP: envBool("FEATURE_STP", false),
  FEATURE_SECURITY_MIN: envBool("FEATURE_SECURITY_MIN", true),
  FEATURE_SIM_OUTBOUND: envBool("FEATURE_SIM_OUTBOUND", true),
} as const;

export function assertSafeCombo(): void {
  if (FEATURES.APP_MODE === "real" && FEATURES.FEATURE_SIM_OUTBOUND) {
    throw new Error("Unsafe: real mode with SIM outbound");
  }
}

export type FeatureFlags = typeof FEATURES;
