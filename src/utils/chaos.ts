export type ChaosFlag = "dbFailover" | "bankTimeout";

type ChaosState = Record<ChaosFlag, boolean>;

const state: ChaosState = {
  dbFailover: process.env.CHAOS_DB_FAILOVER === "1" || process.env.CHAOS_DB_FAILOVER === "true",
  bankTimeout: process.env.CHAOS_BANK_TIMEOUT === "1" || process.env.CHAOS_BANK_TIMEOUT === "true",
};

export function setChaos(flags: Partial<ChaosState>) {
  Object.assign(state, flags);
}

export function resetChaos() {
  state.dbFailover = process.env.CHAOS_DB_FAILOVER === "1" || process.env.CHAOS_DB_FAILOVER === "true";
  state.bankTimeout = process.env.CHAOS_BANK_TIMEOUT === "1" || process.env.CHAOS_BANK_TIMEOUT === "true";
}

export function isChaosEnabled(flag: ChaosFlag): boolean {
  return state[flag];
}

export class ChaosInducedError extends Error {
  constructor(public readonly flag: ChaosFlag, message?: string) {
    super(message ?? `Chaos flag ${flag} triggered`);
    this.name = "ChaosInducedError";
  }
}
