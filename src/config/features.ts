const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);

function parseBool(value: string | undefined, defaultValue = false) {
  if (value === undefined) return defaultValue;
  return TRUE_VALUES.has(value.toLowerCase());
}

export const FEATURES = {
  SIM_OUTBOUND: parseBool(process.env.FEATURE_SIM_OUTBOUND, true),
  BANKING: parseBool(process.env.FEATURE_BANKING, false),
};

export const SETTINGS = {
  APP_MODE: process.env.APP_MODE || "sandbox",
  ALLOW_UNSAFE: parseBool(process.env.ALLOW_UNSAFE, false),
};

if (FEATURES.BANKING && FEATURES.SIM_OUTBOUND) {
  FEATURES.SIM_OUTBOUND = false;
}

export function assertSafeConfig() {
  if (SETTINGS.APP_MODE === "real" && FEATURES.SIM_OUTBOUND && !SETTINGS.ALLOW_UNSAFE) {
    throw new Error("Refusing to start in real mode with simulated outbound rails. Set ALLOW_UNSAFE=true to override.");
  }
}
