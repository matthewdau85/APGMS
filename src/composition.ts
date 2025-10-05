import { MockBanking } from "./adapters/mock/banking.mock";
import { MockPayroll } from "./adapters/mock/payroll.mock";
import { PlaceholderSchedules } from "./adapters/mock/schedules.mock";
import { RealBanking } from "./adapters/real/banking.real";
import { RealPayroll } from "./adapters/real/payroll.real";
import { ATOSchedules } from "./adapters/real/schedules.real";
import { FEATURES } from "./config/features";
import { BankingPort } from "./ports/banking";
import { PayrollPort } from "./ports/payroll";
import { SchedulesPort } from "./ports/schedules";

export const banking: BankingPort = FEATURES.BANKING ? new RealBanking() : new MockBanking();
export const payroll: PayrollPort = FEATURES.STP ? new RealPayroll() : new MockPayroll();
export const schedules: SchedulesPort = FEATURES.ATO_TABLES ? new ATOSchedules() : new PlaceholderSchedules();
