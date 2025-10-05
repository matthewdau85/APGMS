import { RealBankEgress } from "./egress.js";
import { RealBankStatements } from "./statements.js";
import type { BankProvider } from "../port.js";

export function createRealBankProvider(): BankProvider {
  const egress = new RealBankEgress();
  const statements = new RealBankStatements(process.env.BANK_STATEMENTS_DIR);
  return { egress, statements };
}
