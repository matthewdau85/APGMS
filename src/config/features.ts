export type AppMode = "prototype" | "real";

export interface FeatureFlags {
  appMode: AppMode;
  allowUnsafe: boolean;
  simulatorOutbound: boolean;
  raw: Record<string, string>;
}

function parseBoolean(value: string | undefined): boolean {
  if (!value) return false;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

export function createFeatureFlags(env: NodeJS.ProcessEnv = process.env): FeatureFlags {
  const appMode = (env.APP_MODE ?? "prototype").toLowerCase() === "real" ? "real" : "prototype";
  const simulatorOutbound = parseBoolean(env.SIMULATOR_OUTBOUND ?? env.SIM_OUTBOUND ?? env.SIM_OUTBOUND_ENABLED);
  const allowUnsafe = parseBoolean(env.ALLOW_UNSAFE);
  const raw: Record<string, string> = {};
  for (const key of Object.keys(env)) {
    if (key.startsWith("FEATURE_")) {
      raw[key] = env[key] as string;
    }
  }
  raw.APP_MODE = appMode;
  raw.ALLOW_UNSAFE = allowUnsafe ? "true" : "false";
  raw.SIMULATOR_OUTBOUND = simulatorOutbound ? "true" : "false";
  return { appMode, allowUnsafe, simulatorOutbound, raw };
}

export function assertSafeCombo(flags: FeatureFlags) {
  if (flags.appMode === "real" && flags.simulatorOutbound && !flags.allowUnsafe) {
    throw new Error("Unsafe simulator outbound enabled in real mode. Set ALLOW_UNSAFE=true to override.");
  }
}

export function featureFlagsToString(flags: FeatureFlags): string {
  const entries = [
    `appMode=${flags.appMode}`,
    `simulatorOutbound=${flags.simulatorOutbound}`,
    `allowUnsafe=${flags.allowUnsafe}`,
  ];
  const extras = Object.entries(flags.raw)
    .filter(([key]) => key.startsWith("FEATURE_"))
    .map(([key, value]) => `${key.toLowerCase()}=${value}`);
  return [...entries, ...extras].join(" ");
}

