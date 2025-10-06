import dotenv from "dotenv";

dotenv.config();

type AppMode = "prototype" | "real";

const asBoolean = (value: string | undefined, fallback: boolean): boolean => {
  if (value === undefined) {
    return fallback;
  }

  return value.toLowerCase() === "true";
};

const normalizeMode = (value: string | undefined): AppMode => {
  return value === "real" ? "real" : "prototype";
};

export const FEATURES = {
  APP_MODE: normalizeMode(process.env.APP_MODE),
  SIM_INBOUND: asBoolean(process.env.SIM_INBOUND, true),
  SIM_OUTBOUND: asBoolean(process.env.SIM_OUTBOUND, true),
  DRY_RUN: asBoolean(process.env.DRY_RUN, true),
  SHADOW_ONLY: asBoolean(process.env.SHADOW_ONLY, true),
  FEATURE_KMS: asBoolean(process.env.FEATURE_KMS, false),
  FEATURE_TAX_ENGINE: asBoolean(process.env.FEATURE_TAX_ENGINE, true),
  FEATURE_EVIDENCE_V2: asBoolean(process.env.FEATURE_EVIDENCE_V2, true),
  ALLOW_SIM_IN_REAL: asBoolean(process.env.ALLOW_SIM_IN_REAL, false),
} as const;

const hasSimulationEnabled = (): boolean => {
  return (
    FEATURES.SIM_INBOUND ||
    FEATURES.SIM_OUTBOUND ||
    FEATURES.DRY_RUN ||
    FEATURES.SHADOW_ONLY
  );
};

export function assertSafeBoot(): void {
  if (
    FEATURES.APP_MODE === "real" &&
    hasSimulationEnabled() &&
    !FEATURES.ALLOW_SIM_IN_REAL
  ) {
    throw new Error(
      "Unsafe simulation flags set in APP_MODE=real. Set ALLOW_SIM_IN_REAL=true to override (not recommended)."
    );
  }
}

export function isAnySimulationEnabled(): boolean {
  return hasSimulationEnabled();
}
