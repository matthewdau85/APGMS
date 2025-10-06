import { MockBankEgress } from "./egress.js";
import { MockBankStatements } from "./statements.js";
import type { BankProvider } from "../port.js";

export function createMockBankProvider(): BankProvider {
  const statements = new MockBankStatements(process.env.MOCK_BANK_STATEMENTS_DIR);
  const egress = new MockBankEgress();
  return { egress, statements };
}
