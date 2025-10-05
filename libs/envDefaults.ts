export const SAFETY_DEFAULTS = Object.freeze({
  PROTO_KILL_SWITCH: "true",
  PROVIDERS: "bank=mock;kms=mock;rates=mock;statements=mock;anomaly=mock",
  PROTO_BLOCK_ON_ANOMALY: "false",
  PROTO_ENFORCE_RATES_VERSION: "true",
  ALLOW_PERIOD_REOPEN: "true",
  TZ: "Australia/Brisbane",
});

export type SafetyDefaultKey = keyof typeof SAFETY_DEFAULTS;

/**
 * Apply safety-first environment defaults without clobbering explicit values.
 * Returns the mutated env map for convenience/testing.
 */
export function applySafetyDefaults(env: NodeJS.ProcessEnv = process.env) {
  for (const [key, value] of Object.entries(SAFETY_DEFAULTS)) {
    const current = env[key];
    if (current === undefined || current === "") {
      env[key] = value;
    }
  }
  return env;
}
