import {
  AnomalyProvider,
  BankEgressProvider,
  IdentityProvider,
  KmsProvider,
  RatesProvider,
  StatementsProvider,
} from "@core/ports";
import { createMockBankProvider } from "./providers/bank/mockBankProvider";
import { createPostgresBankProvider } from "./providers/bank/postgresBankProvider";
import { createMockKmsProvider } from "./providers/kms/mockKmsProvider";
import { createEnvKmsProvider } from "./providers/kms/envKmsProvider";
import { createMockRatesProvider } from "./providers/rates/mockRatesProvider";
import { createStaticRatesProvider } from "./providers/rates/staticRatesProvider";
import { createMockIdentityProvider } from "./providers/identity/mockIdentityProvider";
import { createDevIdentityProvider } from "./providers/identity/devIdentityProvider";
import { createMockAnomalyProvider } from "./providers/anomaly/mockAnomalyProvider";
import { createDeterministicAnomalyProvider } from "./providers/anomaly/deterministicAnomalyProvider";
import { createMockStatementsProvider } from "./providers/statements/mockStatementsProvider";
import { createLocalStatementsProvider } from "./providers/statements/localStatementsProvider";

export type ProviderKey = "bank" | "kms" | "rates" | "identity" | "anomaly" | "statements";

export type ProviderTypes = {
  bank: BankEgressProvider;
  kms: KmsProvider;
  rates: RatesProvider;
  identity: IdentityProvider;
  anomaly: AnomalyProvider;
  statements: StatementsProvider;
};

export class ProviderKillSwitchError extends Error {
  constructor(public readonly provider: ProviderKey) {
    super(`${provider} provider disabled by kill switch`);
    this.name = "ProviderKillSwitchError";
  }
}

type ProviderFactory<T> = () => T;

export type ProviderFactoryRegistry = {
  [K in ProviderKey]: Record<string, ProviderFactory<ProviderTypes[K]>>;
};

export interface ProviderConfig {
  primary: Partial<Record<ProviderKey, string>>;
  shadow: Partial<Record<ProviderKey, string>>;
  killed: Set<ProviderKey>;
}

const DEFAULT_PROVIDER_SELECTION: Record<ProviderKey, string> = {
  bank: "postgres",
  kms: "env",
  rates: "static",
  identity: "dev",
  anomaly: "deterministic",
  statements: "local",
};

const DEFAULT_FACTORIES: ProviderFactoryRegistry = {
  bank: {
    mock: () => createMockBankProvider(),
    postgres: () => createPostgresBankProvider(),
  },
  kms: {
    mock: () => createMockKmsProvider(),
    env: () => createEnvKmsProvider(),
  },
  rates: {
    mock: () => createMockRatesProvider(),
    static: () => createStaticRatesProvider(),
  },
  identity: {
    mock: () => createMockIdentityProvider(),
    dev: () => createDevIdentityProvider(),
  },
  anomaly: {
    mock: () => createMockAnomalyProvider(),
    deterministic: () => createDeterministicAnomalyProvider(),
  },
  statements: {
    mock: () => createMockStatementsProvider(),
    local: () => createLocalStatementsProvider(),
  },
};

const KEY_ALIASES: Record<string, ProviderKey> = {
  bank: "bank",
  kms: "kms",
  rates: "rates",
  idp: "identity",
  identity: "identity",
  anomaly: "anomaly",
  statements: "statements",
};

function normalizeKey(key: string): ProviderKey | undefined {
  return KEY_ALIASES[key.trim().toLowerCase()];
}

function parseProviderMapping(value: string | undefined): Partial<Record<ProviderKey, string>> {
  const result: Partial<Record<ProviderKey, string>> = {};
  if (!value) return result;
  for (const entry of value.split(/[;\n]/)) {
    if (!entry.trim()) continue;
    const [rawKey, rawProvider] = entry.split("=");
    if (!rawKey || !rawProvider) continue;
    const key = normalizeKey(rawKey);
    if (!key) continue;
    result[key] = rawProvider.trim();
  }
  return result;
}

function parseKillSwitches(value: string | undefined): Set<ProviderKey> {
  const set = new Set<ProviderKey>();
  if (!value) return set;
  for (const entry of value.split(/[,;\n]/)) {
    const key = normalizeKey(entry);
    if (key) set.add(key);
  }
  return set;
}

function mergeFactories(
  defaults: ProviderFactoryRegistry,
  overrides: Partial<ProviderFactoryRegistry> | undefined
): ProviderFactoryRegistry {
  if (!overrides) return defaults;
  const merged = { ...defaults } as ProviderFactoryRegistry;
  for (const key of Object.keys(overrides) as ProviderKey[]) {
    merged[key] = { ...defaults[key], ...overrides[key] };
  }
  return merged;
}

export function loadProviderConfig(env: NodeJS.ProcessEnv = process.env): ProviderConfig {
  const primary = parseProviderMapping(env.PROVIDERS);
  const shadow = parseProviderMapping(env.PROVIDERS_SHADOW);
  const killed = parseKillSwitches(env.PROVIDER_KILL_SWITCHES);
  return { primary, shadow, killed };
}

export class ProviderRegistry {
  private readonly factories: ProviderFactoryRegistry;
  private readonly cache = new Map<ProviderKey, ProviderTypes[ProviderKey]>();
  private readonly primaries = new Map<ProviderKey, ProviderTypes[ProviderKey]>();
  private readonly shadows = new Map<ProviderKey, ProviderTypes[ProviderKey]>();

  constructor(private readonly config: ProviderConfig, factoryOverrides?: Partial<ProviderFactoryRegistry>) {
    this.factories = mergeFactories(DEFAULT_FACTORIES, factoryOverrides);
  }

  static fromEnv(factoryOverrides?: Partial<ProviderFactoryRegistry>): ProviderRegistry {
    return new ProviderRegistry(loadProviderConfig(), factoryOverrides);
  }

  get<K extends ProviderKey>(key: K): ProviderTypes[K] {
    const killSwitch = this.config.killed;
    if (killSwitch.has(key)) {
      throw new ProviderKillSwitchError(key);
    }
    if (!this.cache.has(key)) {
      const provider = this.createFacade(key);
      this.cache.set(key, provider);
    }
    return this.cache.get(key)! as ProviderTypes[K];
  }

  private instantiate<K extends ProviderKey>(key: K, name: string): ProviderTypes[K] {
    const factories = this.factories[key];
    const factory = factories[name];
    if (!factory) {
      const available = Object.keys(factories).join(", ");
      throw new Error(`No provider factory registered for ${key} named ${name}. Available: ${available}`);
    }
    return factory();
  }

  private resolvePrimaryName(key: ProviderKey): string {
    return this.config.primary[key] ?? DEFAULT_PROVIDER_SELECTION[key];
  }

  private resolveShadowName(key: ProviderKey): string | undefined {
    return this.config.shadow[key];
  }

  private createFacade<K extends ProviderKey>(key: K): ProviderTypes[K] {
    const primaryName = this.resolvePrimaryName(key);
    const primary = this.primaries.get(key) ?? this.instantiate(key, primaryName);
    this.primaries.set(key, primary);

    const shadowName = this.resolveShadowName(key);
    const shadow = shadowName
      ? this.shadows.get(key) ?? this.instantiate(key, shadowName as string)
      : undefined;
    if (shadowName && shadow) {
      this.shadows.set(key, shadow);
    }

    const registry = this;
    const handler: ProxyHandler<ProviderTypes[K]> = {
      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver);
        if (typeof value !== "function") {
          return value;
        }
        return async function providerMethod(this: unknown, ...args: any[]) {
          if (registry.config.killed.has(key)) {
            throw new ProviderKillSwitchError(key);
          }
          const resultPromise = Promise.resolve(value.apply(primary, args));
          const shadowImpl = shadow && (shadow as any)[prop];
          if (typeof shadowImpl === "function") {
            resultPromise
              .then(
                (result) => {
                  Promise.resolve(shadowImpl.apply(shadow, args)).catch((err) => {
                    console.warn(`[shadow:${String(key)}]`, err);
                  });
                  return result;
                },
                (err) => {
                  Promise.resolve(shadowImpl.apply(shadow, args)).catch((shadowErr) => {
                    console.warn(`[shadow:${String(key)}]`, shadowErr);
                  });
                  throw err;
                }
              );
          }
          return resultPromise;
        };
      },
    };

    return new Proxy(primary, handler);
  }
}

export const providerRegistry = ProviderRegistry.fromEnv();
