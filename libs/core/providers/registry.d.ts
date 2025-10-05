import type {
  BankEgressPort,
  BankStatementsPort,
  KmsPort,
  RatesPort,
  IdentityPort,
  AnomalyPort
} from '@core/ports';

export type ProviderVariant = 'mock' | 'real';

export type ProviderBindings = {
  bank: ProviderVariant;
  bankStatements: ProviderVariant;
  kms: ProviderVariant;
  rates: ProviderVariant;
  identity: ProviderVariant;
  anomaly: ProviderVariant;
};

export declare function reloadBindings(): void;
export declare function getBank(): BankEgressPort;
export declare function getBankStatements(): BankStatementsPort;
export declare function getKms(): KmsPort;
export declare function getRates(): RatesPort;
export declare function getIdentity(): IdentityPort;
export declare function getAnomaly(): AnomalyPort;
export declare function bindings(): ProviderBindings;
export declare function describeProviders(): Array<{ port: string; variant: ProviderVariant }>;
