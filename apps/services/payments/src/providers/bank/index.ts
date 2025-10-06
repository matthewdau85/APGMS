import type { BankProvider } from "./port.js";
import { createMockBankProvider } from "./mock/index.js";
import { createRealBankProvider } from "./real/index.js";

let provider: BankProvider | undefined;

export function selectBankProvider(): BankProvider {
  if (!provider) {
    const mode = (process.env.BANK_PROVIDER ?? "mock").toLowerCase();
    provider = mode === "real" ? createRealBankProvider() : createMockBankProvider();
    provider.statements.start().catch(err => {
      console.error("[bank] failed to start statement watcher", err);
    });
  }
  return provider;
}

export { BankEgressPort, BankStatementsPort, BankProvider, PayoutRequest, PayoutResult, PayoutResultStatus } from "./port.js";
