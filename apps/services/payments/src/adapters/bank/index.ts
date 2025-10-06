import { BankingPort } from "./BankingPort.js";
import { MtlsBanking } from "./MtlsBanking.js";
import { SimRail } from "./SimRail.js";

const simRail = new SimRail();

export function getSimRail(): SimRail {
  return simRail;
}

export function selectBankingPort(): BankingPort {
  if ((process.env.BANK_MODE || "sim").toLowerCase() === "mtls") {
    const base = process.env.BANK_API_BASE ?? "https://localhost:8443";
    return new MtlsBanking(base);
  }
  return simRail;
}

export function isSimPort(port: BankingPort): port is SimRail {
  return port instanceof SimRail;
}
