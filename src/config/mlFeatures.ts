export interface MlFeatureFlags {
  global: boolean;
  recon_scorer: boolean;
  bank_matcher: boolean;
  forecast: boolean;
  invoice_ner: boolean;
}

export type MlFeature = Exclude<keyof MlFeatureFlags, "global">;

type MlFeatureOverrides = Record<MlFeature, boolean>;

type MlDisableReason = "global_disabled" | "feature_disabled";

const FEATURE_ENV_MAP: Record<MlFeature, { env: string; default: boolean }> = {
  recon_scorer: { env: "FEATURE_ML_RECON", default: true },
  bank_matcher: { env: "FEATURE_ML_MATCH", default: true },
  forecast: { env: "FEATURE_ML_FORECAST", default: true },
  invoice_ner: { env: "FEATURE_ML_INVOICE_NER", default: true },
};

function envFlag(name: string, defaultValue: boolean): boolean {
  const raw = process.env[name];
  if (raw == null) return defaultValue;
  return /^(1|true|yes|on)$/i.test(raw.trim());
}

function parseOverrides(): MlFeatureOverrides {
  return {
    recon_scorer: envFlag(FEATURE_ENV_MAP.recon_scorer.env, FEATURE_ENV_MAP.recon_scorer.default),
    bank_matcher: envFlag(FEATURE_ENV_MAP.bank_matcher.env, FEATURE_ENV_MAP.bank_matcher.default),
    forecast: envFlag(FEATURE_ENV_MAP.forecast.env, FEATURE_ENV_MAP.forecast.default),
    invoice_ner: envFlag(FEATURE_ENV_MAP.invoice_ner.env, FEATURE_ENV_MAP.invoice_ner.default),
  };
}

function computeFlags(): MlFeatureFlags {
  const globalEnabled = envFlag("FEATURE_ML", true);
  const overrides = parseOverrides();
  return {
    global: globalEnabled,
    recon_scorer: globalEnabled && overrides.recon_scorer,
    bank_matcher: globalEnabled && overrides.bank_matcher,
    forecast: globalEnabled && overrides.forecast,
    invoice_ner: globalEnabled && overrides.invoice_ner,
  };
}

export interface MlFeatureStatus {
  enabled: boolean;
  reason?: MlDisableReason;
  flags: MlFeatureFlags;
}

export function evaluateMlFeature(feature: MlFeature): MlFeatureStatus {
  const globalEnabled = envFlag("FEATURE_ML", true);
  const overrides = parseOverrides();
  const flags = computeFlags();

  if (!globalEnabled) {
    return { enabled: false, reason: "global_disabled", flags };
  }

  if (!overrides[feature]) {
    return { enabled: false, reason: "feature_disabled", flags };
  }

  return { enabled: true, flags };
}

export interface MlFeatureStatusResponse {
  ml: MlFeatureFlags;
}

export function getMlFeatureStatus(): MlFeatureStatusResponse {
  return { ml: computeFlags() };
}
