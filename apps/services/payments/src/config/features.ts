// apps/services/payments/src/config/features.ts

export type FeatureFlags = {
  APP_MODE: string;
  FEATURE_SIM_OUTBOUND: boolean;
  ALLOW_UNSAFE: boolean;
};

const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);

function toBool(value: string | undefined): boolean {
  if (!value) return false;
  return TRUE_VALUES.has(value.trim().toLowerCase());
}

function normalizeMode(mode: string | undefined): string {
  if (!mode) return "sim";
  const lower = mode.trim().toLowerCase();
  return lower === "real" ? "real" : lower || "sim";
}

export function loadFeatureFlags(env: NodeJS.ProcessEnv = process.env): FeatureFlags {
  return {
    APP_MODE: normalizeMode(env.APP_MODE),
    FEATURE_SIM_OUTBOUND: toBool(env.FEATURE_SIM_OUTBOUND),
    ALLOW_UNSAFE: toBool(env.ALLOW_UNSAFE),
  };
}

export function assertSafeCombo(flags: FeatureFlags): void {
  if (flags.APP_MODE === "real" && flags.FEATURE_SIM_OUTBOUND && !flags.ALLOW_UNSAFE) {
    throw new Error(
      "FEATURE_SIM_OUTBOUND cannot be enabled with APP_MODE=real unless ALLOW_UNSAFE=true"
    );
  }
}

type Logger = { log: (...args: any[]) => void };

export function logFeatureFlags(flags: FeatureFlags, logger: Logger = console): void {
  const line = Object.entries(flags)
    .map(([key, value]) => `${key}=${typeof value === "boolean" ? (value ? "true" : "false") : value}`)
    .join(" ");
  logger.log(`[features] ${line}`);
}
