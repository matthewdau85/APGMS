import type { Pool } from "pg";
import { SimRail, DbSimSettlementRepository } from "./simRail.js";
import { MtlsBanking } from "./mtlsBanking.js";
import type { BankingPort } from "./types.js";

export { SimRail } from "./simRail.js";
export { MtlsBanking } from "./mtlsBanking.js";
export * from "./types.js";

export function selectBankingPort(pool: Pool): BankingPort {
  const adapter = (process.env.BANKING_ADAPTER || "sim").toLowerCase();
  if (adapter === "mtls") {
    return new MtlsBanking({ pool });
  }
  return new SimRail({ repository: new DbSimSettlementRepository(pool) });
}

