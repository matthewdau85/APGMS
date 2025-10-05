import { BankingPort } from "./ports/banking";
import { PayrollPort } from "./ports/payroll";
import { PosPort } from "./ports/pos";
import { MockBanking } from "./adapters/mock/banking.mock";
import { RealBanking } from "./adapters/real/banking.real";
import { MockPayroll } from "./adapters/mock/payroll.mock";
import { RealPayroll } from "./adapters/real/payroll.real";
import { MockPos } from "./adapters/mock/pos.mock";
import { RealPos } from "./adapters/real/pos.real";

const bankingEnabled = process.env.FEATURE_BANKING === "true";
const payrollEnabled = process.env.FEATURE_PAYROLL === "true";
const posEnabled = process.env.FEATURE_POS === "true";

export const banking: BankingPort = bankingEnabled ? new RealBanking() : new MockBanking();
export const payroll: PayrollPort = payrollEnabled ? new RealPayroll() : new MockPayroll();
export const pos: PosPort = posEnabled ? new RealPos() : new MockPos();
