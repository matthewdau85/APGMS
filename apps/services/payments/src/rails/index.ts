import { RailsConfig } from '../config/rails.js';
import { BankingPort } from './ports.js';
import { RealAdapter } from '../bank/realAdapter.js';
import { MockAdapter } from '../bank/mockAdapter.js';

let singleton: BankingPort | null = null;

export function resolveBankingPort(): BankingPort {
  if (!singleton) {
    singleton = RailsConfig.FEATURE_RAILS_REAL ? new RealAdapter() : new MockAdapter();
  }
  return singleton;
}
