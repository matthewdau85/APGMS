import type { BASHistory } from "../types/tax";

export type RuntimeMode = "sandbox" | "production";

export interface RuntimeFlags {
  /** When true the UI will continue to use the local mock dataset. */
  useMockData: boolean;
  /** Attempt to fetch live data automatically on boot. */
  autoLoadLiveData: boolean;
  /** When true, failures fall back to mock data rather than surfacing errors. */
  fallbackToMockOnError: boolean;
  /** Allow inbound webhook processing in the current environment. */
  enableWebhooks: boolean;
}

export interface BankingRuntimeConfig {
  rail: "PAYTO" | "CDR" | "BPAY" | "EFT";
  baseUrl: string | null;
  clientId: string | null;
  signingKeyId: string | null;
}

export interface PayrollRuntimeConfig {
  provider: string;
  baseUrl: string | null;
  pollingIntervalSeconds: number;
  webhookEnabled: boolean;
}

export interface PosRuntimeConfig {
  provider: string;
  baseUrl: string | null;
  pollingIntervalSeconds: number;
  webhookEnabled: boolean;
}

export interface PublicRuntimeConfig {
  mode: RuntimeMode;
  version: string;
  flags: RuntimeFlags;
  banking: BankingRuntimeConfig;
  payroll: PayrollRuntimeConfig;
  pos: PosRuntimeConfig;
}

type EnvDictionary = Record<string, string | undefined>;

const DEFAULT_PUBLIC_CONFIG: PublicRuntimeConfig = {
  mode: "sandbox",
  version: "dev",
  flags: {
    useMockData: true,
    autoLoadLiveData: false,
    fallbackToMockOnError: true,
    enableWebhooks: false,
  },
  banking: {
    rail: "PAYTO",
    baseUrl: null,
    clientId: null,
    signingKeyId: null,
  },
  payroll: {
    provider: "mock",
    baseUrl: null,
    pollingIntervalSeconds: 900,
    webhookEnabled: false,
  },
  pos: {
    provider: "mock",
    baseUrl: null,
    pollingIntervalSeconds: 900,
    webhookEnabled: false,
  },
};

function readEnv(env: EnvDictionary | undefined, key: string): string | undefined {
  if (!env) return undefined;
  if (key in env && env[key] !== undefined) return env[key];
  const reactStyle = `REACT_APP_${key}`;
  if (reactStyle in env && env[reactStyle] !== undefined) return env[reactStyle];
  const nextStyle = `NEXT_PUBLIC_${key}`;
  if (nextStyle in env && env[nextStyle] !== undefined) return env[nextStyle];
  return undefined;
}

function readBool(env: EnvDictionary | undefined, key: string, fallback: boolean): boolean {
  const raw = readEnv(env, key);
  if (raw === undefined) return fallback;
  return /^(1|true|yes|on)$/i.test(raw.trim());
}

function readNumber(env: EnvDictionary | undefined, key: string, fallback: number): number {
  const raw = readEnv(env, key);
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readRail(env: EnvDictionary | undefined, key: string, fallback: BankingRuntimeConfig["rail"]): BankingRuntimeConfig["rail"] {
  const raw = readEnv(env, key);
  if (!raw) return fallback;
  const upper = raw.toUpperCase();
  if (upper === "PAYTO" || upper === "CDR" || upper === "BPAY" || upper === "EFT") {
    return upper;
  }
  return fallback;
}

export function buildPublicRuntimeConfig(env?: EnvDictionary): PublicRuntimeConfig {
  const mode = (readEnv(env, "APGMS_ENV")?.toLowerCase() === "production" ? "production" : "sandbox") as RuntimeMode;

  return {
    mode,
    version: readEnv(env, "APGMS_VERSION") ?? DEFAULT_PUBLIC_CONFIG.version,
    flags: {
      useMockData: readBool(env, "APGMS_USE_MOCKS", mode !== "production"),
      autoLoadLiveData: readBool(env, "APGMS_AUTO_LOAD_LIVE", mode === "production"),
      fallbackToMockOnError: readBool(env, "APGMS_FALLBACK_TO_MOCK", true),
      enableWebhooks: readBool(env, "APGMS_ENABLE_WEBHOOKS", mode === "production"),
    },
    banking: {
      rail: readRail(env, "APGMS_BANK_RAIL", DEFAULT_PUBLIC_CONFIG.banking.rail),
      baseUrl: readEnv(env, "APGMS_BANK_BASE_URL") ?? DEFAULT_PUBLIC_CONFIG.banking.baseUrl,
      clientId: readEnv(env, "APGMS_BANK_CLIENT_ID") ?? DEFAULT_PUBLIC_CONFIG.banking.clientId,
      signingKeyId: readEnv(env, "APGMS_BANK_SIGNING_KEY_ID") ?? DEFAULT_PUBLIC_CONFIG.banking.signingKeyId,
    },
    payroll: {
      provider: readEnv(env, "APGMS_PAYROLL_PROVIDER") ?? DEFAULT_PUBLIC_CONFIG.payroll.provider,
      baseUrl: readEnv(env, "APGMS_PAYROLL_BASE_URL") ?? DEFAULT_PUBLIC_CONFIG.payroll.baseUrl,
      pollingIntervalSeconds: readNumber(env, "APGMS_PAYROLL_POLL_INTERVAL", DEFAULT_PUBLIC_CONFIG.payroll.pollingIntervalSeconds),
      webhookEnabled: readBool(env, "APGMS_PAYROLL_WEBHOOKS", DEFAULT_PUBLIC_CONFIG.payroll.webhookEnabled),
    },
    pos: {
      provider: readEnv(env, "APGMS_POS_PROVIDER") ?? DEFAULT_PUBLIC_CONFIG.pos.provider,
      baseUrl: readEnv(env, "APGMS_POS_BASE_URL") ?? DEFAULT_PUBLIC_CONFIG.pos.baseUrl,
      pollingIntervalSeconds: readNumber(env, "APGMS_POS_POLL_INTERVAL", DEFAULT_PUBLIC_CONFIG.pos.pollingIntervalSeconds),
      webhookEnabled: readBool(env, "APGMS_POS_WEBHOOKS", DEFAULT_PUBLIC_CONFIG.pos.webhookEnabled),
    },
  };
}

export function getPublicRuntimeConfig(): PublicRuntimeConfig {
  if (typeof globalThis !== "undefined" && (globalThis as any).__APGMS_CONFIG__) {
    return (globalThis as any).__APGMS_CONFIG__ as PublicRuntimeConfig;
  }

  if (typeof process !== "undefined" && process.env) {
    return buildPublicRuntimeConfig(process.env as EnvDictionary);
  }

  if (typeof window !== "undefined" && (window as any).__APGMS_CONFIG__) {
    return (window as any).__APGMS_CONFIG__ as PublicRuntimeConfig;
  }

  return { ...DEFAULT_PUBLIC_CONFIG };
}

export async function fetchRuntimeConfig(signal?: AbortSignal): Promise<PublicRuntimeConfig> {
  if (typeof fetch !== "function") {
    const local = getPublicRuntimeConfig();
    (globalThis as any).__APGMS_CONFIG__ = local;
    return local;
  }

  try {
    const res = await fetch("/api/config", {
      method: "GET",
      headers: { Accept: "application/json" },
      signal,
    });

    if (!res.ok) {
      throw new Error(`Config request failed with status ${res.status}`);
    }

    const parsed = (await res.json()) as PublicRuntimeConfig;
    (globalThis as any).__APGMS_CONFIG__ = parsed;
    return parsed;
  } catch (error) {
    console.warn("Falling back to local runtime config", error);
    const fallback = getPublicRuntimeConfig();
    (globalThis as any).__APGMS_CONFIG__ = fallback;
    return fallback;
  }
}

export function normaliseBasHistory(entries: BASHistory[]): BASHistory[] {
  return entries
    .map((entry) => ({
      ...entry,
      period: new Date(entry.period),
    }))
    .sort((a, b) => b.period.getTime() - a.period.getTime());
}
