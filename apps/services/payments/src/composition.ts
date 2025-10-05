import type { BankingPort } from "./ports/banking";
import type { PayrollPort } from "./ports/payroll";
import type { PosPort } from "./ports/pos";
import { createMockBankingAdapter } from "./adapters/mock/banking.mock";
import { createRealBankingAdapter } from "./adapters/real/banking.real";

function isEnabled(value: string | undefined) {
  return /^(1|true|yes|on|real)$/i.test(value ?? "");
}

function createPrototypePayroll(): PayrollPort {
  return {
    async ingestStp() {
      // Prototype placeholder: intentionally no-op
      return Promise.resolve();
    },
  };
}

function createPrototypePos(): PosPort {
  return {
    async ingestSale() {
      // Prototype placeholder: intentionally no-op
      return Promise.resolve();
    },
  };
}

const bankingFeatureEnabled = isEnabled(process.env.FEATURE_BANKING);
const stpFeatureEnabled = isEnabled(process.env.FEATURE_STP);

const bankingAdapter: BankingPort = bankingFeatureEnabled
  ? createRealBankingAdapter()
  : createMockBankingAdapter();

const payrollAdapter: PayrollPort = stpFeatureEnabled
  ? createPrototypePayroll()
  : createPrototypePayroll();

const posAdapter: PosPort = createPrototypePos();

export const composition = {
  ports: {
    banking: bankingAdapter,
    payroll: payrollAdapter,
    pos: posAdapter,
  },
  features: {
    banking: bankingFeatureEnabled ? "real" : "mock",
    stp: stpFeatureEnabled ? "real" : "mock",
  },
};

export type AppComposition = typeof composition;

export function getComposition(): AppComposition {
  return composition;
}
