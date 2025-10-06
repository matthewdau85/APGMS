import type {
  AnomalyPort,
  BankEgressPort,
  KmsPort,
  RatesPort,
  StatementsPort
} from "@core/ports";
import { createMockBankEgressPort } from "@providers/bank/mock";
import { createRealBankEgressPort } from "@providers/bank/real";
import { createShadowBankEgressPort } from "@providers/bank/shadow";
import { createMockKmsPort } from "@providers/kms/mock";
import { createRealKmsPort } from "@providers/kms/real";
import { createShadowKmsPort } from "@providers/kms/shadow";
import { createMockRatesPort } from "@providers/rates/mock";
import { createRealRatesPort } from "@providers/rates/real";
import { createShadowRatesPort } from "@providers/rates/shadow";
import { createMockStatementsPort } from "@providers/statements/mock";
import { createRealStatementsPort } from "@providers/statements/real";
import { createShadowStatementsPort } from "@providers/statements/shadow";
import { createMockAnomalyPort } from "@providers/anomaly/mock";
import { createRealAnomalyPort } from "@providers/anomaly/real";
import { createShadowAnomalyPort } from "@providers/anomaly/shadow";

export type ProviderName = "bank" | "kms" | "rates" | "statements" | "anomaly";
export type ProviderMode = "mock" | "real" | "shadow";
export type ProviderBindings = Record<ProviderName, ProviderMode>;

type ProviderInstanceMap = {
  bank: BankEgressPort;
  kms: KmsPort;
  rates: RatesPort;
  statements: StatementsPort;
  anomaly: AnomalyPort;
};

type ProviderFactories = {
  [K in ProviderName]: Record<ProviderMode, () => ProviderInstanceMap[K]>;
};

const factories: ProviderFactories = {
  bank: {
    mock: createMockBankEgressPort,
    real: createRealBankEgressPort,
    shadow: createShadowBankEgressPort
  },
  kms: {
    mock: createMockKmsPort,
    real: createRealKmsPort,
    shadow: createShadowKmsPort
  },
  rates: {
    mock: createMockRatesPort,
    real: createRealRatesPort,
    shadow: createShadowRatesPort
  },
  statements: {
    mock: createMockStatementsPort,
    real: createRealStatementsPort,
    shadow: createShadowStatementsPort
  },
  anomaly: {
    mock: createMockAnomalyPort,
    real: createRealAnomalyPort,
    shadow: createShadowAnomalyPort
  }
};

const DEFAULT_BINDINGS: ProviderBindings = {
  bank: "mock",
  kms: "mock",
  rates: "mock",
  statements: "mock",
  anomaly: "mock"
};

function parseBindings(): ProviderBindings {
  const input = process.env.PROVIDERS;
  if (!input) return { ...DEFAULT_BINDINGS };

  const bindings: ProviderBindings = { ...DEFAULT_BINDINGS };
  const chunks = input.split(/[;\n]+/).map((chunk) => chunk.trim()).filter(Boolean);
  for (const chunk of chunks) {
    const [rawKey, rawValue] = chunk.split("=");
    if (!rawKey || !rawValue) continue;
    const key = rawKey.trim().toLowerCase() as ProviderName;
    const value = rawValue.trim().toLowerCase() as ProviderMode;
    if (Object.prototype.hasOwnProperty.call(DEFAULT_BINDINGS, key) && ["mock", "real", "shadow"].includes(value)) {
      bindings[key] = value;
    }
  }
  return bindings;
}

const resolvedBindings: ProviderBindings = parseBindings();
const instances: Partial<ProviderInstanceMap> = {};

function ensure<Name extends ProviderName>(name: Name): ProviderInstanceMap[Name] {
  if (!instances[name]) {
    const mode = resolvedBindings[name];
    const factory = factories[name][mode];
    instances[name] = factory();
  }
  return instances[name]!;
}

export function getProviderBindings(): ProviderBindings {
  return { ...resolvedBindings };
}

export function useBank(): BankEgressPort {
  return ensure("bank");
}

export function useKms(): KmsPort {
  return ensure("kms");
}

export function useRates(): RatesPort {
  return ensure("rates");
}

export function useStatements(): StatementsPort {
  return ensure("statements");
}

export function useAnomaly(): AnomalyPort {
  return ensure("anomaly");
}

export type ProviderDiagnostics = {
  binding: ProviderMode;
  capabilities: string[];
};

function extractCapabilities(port: { getCapabilities?: () => string[] } | undefined): string[] {
  return port?.getCapabilities?.() ?? [];
}

export function describeProviders(): Record<ProviderName, ProviderDiagnostics> {
  return {
    bank: { binding: resolvedBindings.bank, capabilities: extractCapabilities(useBank()) },
    kms: { binding: resolvedBindings.kms, capabilities: extractCapabilities(useKms()) },
    rates: { binding: resolvedBindings.rates, capabilities: extractCapabilities(useRates()) },
    statements: { binding: resolvedBindings.statements, capabilities: extractCapabilities(useStatements()) },
    anomaly: { binding: resolvedBindings.anomaly, capabilities: extractCapabilities(useAnomaly()) }
  };
}

export function resetProviderCacheForTests() {
  delete instances.bank;
  delete instances.kms;
  delete instances.rates;
  delete instances.statements;
  delete instances.anomaly;
}
