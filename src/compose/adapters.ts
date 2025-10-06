import { FEATURES } from "../config/features";
import { BankingPort } from "../ports/banking";
import { MockBanking } from "../sim/bank/MockBanking";
import { MtlsBanking } from "../adapters/bank/MtlsBanking";
import { Recorder } from "../sim/recorder";
import { PayrollPort } from "../ports/payroll";
import { SimPayroll } from "../sim/payroll/SimPayroll";
import { WebhookPayroll } from "../adapters/payroll/WebhookPayroll";
import { PosPort } from "../ports/pos";
import { SimPOS } from "../sim/pos/SimPOS";
import { WebhookPOS } from "../adapters/pos/WebhookPOS";

export const banking: BankingPort =
  process.env.SIM_REPLAY === "true"
    ? new Recorder(
        FEATURES.SIM_OUTBOUND ? new MockBanking() : new MtlsBanking()
      )
    : FEATURES.SIM_OUTBOUND
    ? new MockBanking()
    : new MtlsBanking();

export const payroll: PayrollPort = FEATURES.SIM_INBOUND
  ? new SimPayroll()
  : new WebhookPayroll();
export const pos: PosPort = FEATURES.SIM_INBOUND
  ? new SimPOS()
  : new WebhookPOS();
