import { MockBankEgress } from './implementations/bank-mock.js';
import { RealBankEgress } from './implementations/bank-real.js';
import { MockBankStatements } from './implementations/bank-statements-mock.js';
import { RealBankStatements } from './implementations/bank-statements-real.js';
import { MockKms } from './implementations/kms-mock.js';
import { RealKms } from './implementations/kms-real.js';
import { MockRates } from './implementations/rates-mock.js';
import { RealRates } from './implementations/rates-real.js';
import { MockIdentity } from './implementations/identity-mock.js';
import { RealIdentity } from './implementations/identity-real.js';
import { MockAnomaly } from './implementations/anomaly-mock.js';
import { RealAnomaly } from './implementations/anomaly-real.js';

const DEFAULT_BINDINGS = {
  bank: 'mock',
  bankStatements: 'mock',
  kms: 'mock',
  rates: 'mock',
  identity: 'mock',
  anomaly: 'mock'
};

const factories = {
  bank: {
    mock: () => new MockBankEgress(),
    real: () => new RealBankEgress()
  },
  bankStatements: {
    mock: () => new MockBankStatements(),
    real: () => new RealBankStatements()
  },
  kms: {
    mock: () => new MockKms(),
    real: () => new RealKms()
  },
  rates: {
    mock: () => new MockRates(),
    real: () => new RealRates()
  },
  identity: {
    mock: () => new MockIdentity(),
    real: () => new RealIdentity()
  },
  anomaly: {
    mock: () => new MockAnomaly(),
    real: () => new RealAnomaly()
  }
};

const cache = new Map();
let currentBindings = resolveBindings();

function resolveBindings() {
  try {
    if (!process.env.PROVIDERS) {
      return { ...DEFAULT_BINDINGS };
    }
    const parsed = JSON.parse(process.env.PROVIDERS);
    return { ...DEFAULT_BINDINGS, ...parsed };
  } catch (err) {
    console.warn('[providers] Failed to parse PROVIDERS env, falling back to defaults', err);
    return { ...DEFAULT_BINDINGS };
  }
}

function instantiate(port) {
  const variant = currentBindings[port] || 'mock';
  const key = `${port}:${variant}`;
  if (cache.has(key)) {
    return cache.get(key);
  }
  const factoryGroup = factories[port];
  if (!factoryGroup) {
    throw new Error(`Unknown port ${port}`);
  }
  const factory = factoryGroup[variant];
  if (!factory) {
    const available = Object.keys(factoryGroup).join(', ');
    throw new Error(`No ${variant} implementation registered for ${port}. Available: ${available}`);
  }
  const instance = factory();
  cache.set(key, instance);
  return instance;
}

export function reloadBindings() {
  currentBindings = resolveBindings();
  cache.clear();
}

export function getBank() {
  return instantiate('bank');
}

export function getBankStatements() {
  return instantiate('bankStatements');
}

export function getKms() {
  return instantiate('kms');
}

export function getRates() {
  return instantiate('rates');
}

export function getIdentity() {
  return instantiate('identity');
}

export function getAnomaly() {
  return instantiate('anomaly');
}

export function bindings() {
  return { ...currentBindings };
}

export function describeProviders() {
  return Object.entries(currentBindings).map(([port, variant]) => ({ port, variant }));
}
