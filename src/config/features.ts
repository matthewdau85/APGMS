const TRUTHY = new Set(["1", "true", "yes", "on"]);
const FALSY = new Set(["0", "false", "no", "off"]);

function parseFlag(value: string | undefined, fallback: boolean): boolean {
  if (value == null) return fallback;
  const normalized = value.trim().toLowerCase();
  if (TRUTHY.has(normalized)) return true;
  if (FALSY.has(normalized)) return false;
  return fallback;
}

export const FEATURES = {
  /**
   * When true we avoid calling external banking providers and instead
   * simulate success locally. This defaults to true so that real side effects
   * only occur once explicitly enabled.
   */
  DRY_RUN: parseFlag(process.env.FEATURE_DRY_RUN ?? process.env.DRY_RUN, true),
  /** Shadow mode keeps behaviour read-only while still exercising code paths. */
  SHADOW_ONLY: parseFlag(process.env.FEATURE_SHADOW_ONLY, false),
  /**
   * Controls whether settlement webhooks should attempt to link evidence
   * bundles immediately after recording the settlement payload.
   */
  SETTLEMENT_LINK: parseFlag(process.env.FEATURE_SETTLEMENT_LINK, false),
} as const;

export type FeatureFlags = typeof FEATURES;
export { parseFlag as parseFeatureFlag };
