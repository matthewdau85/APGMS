export interface FeatureFlags {
  enablePrototypeFlows: boolean;
  enableReadinessApi: boolean;
  enablePilotRails: boolean;
  readOnlyMode: boolean;
}

let cachedFlags: FeatureFlags | null = null;
let logged = false;

export function featureFlags(): FeatureFlags {
  if (!cachedFlags) {
    cachedFlags = {
      enablePrototypeFlows: readBool(process.env.FEATURE_PROTOTYPE ?? "true"),
      enableReadinessApi: readBool(process.env.FEATURE_READINESS_API ?? "true"),
      enablePilotRails: readBool(process.env.FEATURE_PILOT_RAILS ?? "false"),
      readOnlyMode: readBool(process.env.FEATURE_READ_ONLY ?? "false")
    };
  }
  if (!logged) {
    console.log(`[features] ${JSON.stringify(cachedFlags)}`);
    logged = true;
  }
  return cachedFlags;
}

export function assertSafeCombo(flags: FeatureFlags = featureFlags()) {
  if (flags.enablePilotRails && !flags.enableReadinessApi) {
    throw new Error("Unsafe feature combo: pilot rails requires readiness API");
  }
  if (flags.readOnlyMode && flags.enablePilotRails) {
    throw new Error("Unsafe feature combo: cannot run pilot rails in read-only mode");
  }
}

function readBool(value: string): boolean {
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}
