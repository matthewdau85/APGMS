import { randomUUID } from "node:crypto";
import type { BankingPort, BankingResult, EftRequest, BpayRequest, PayToSweepRequest } from "../index.js";

function buildSynthetic(providerPrefix: string, transferUuid?: string): BankingResult {
  const uuid = transferUuid ?? randomUUID();
  return {
    transferUuid: uuid,
    providerRef: `${providerPrefix}:mock:${uuid.slice(0, 12)}`,
  };
}

export const mockBankingPort: BankingPort = {
  async eft(request: EftRequest): Promise<BankingResult> {
    return buildSynthetic("eft", request.transferUuid);
  },
  async bpay(request: BpayRequest): Promise<BankingResult> {
    return buildSynthetic("bpay", request.transferUuid);
  },
  async payToSweep(request: PayToSweepRequest): Promise<BankingResult> {
    return buildSynthetic("payto", request.transferUuid);
  },
};
