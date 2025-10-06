import { FEATURES } from "../../config/features";
import { MtlsBanking, BankingResponse, buildMtlsAgent } from "./MtlsBanking";
import { MockBanking } from "./MockBanking";

export interface BankingPort {
  eft(args: { abn: string; bsb: string; acct: string; amountCents: number; idemKey?: string }): Promise<BankingResponse>;
  bpay(args: { abn: string; crn: string; amountCents: number; idemKey?: string }): Promise<BankingResponse>;
}

function hasMtlsMaterial() {
  return Boolean(process.env.MTLS_CERT && process.env.MTLS_KEY && process.env.MTLS_CA);
}

function buildMtlsInstance(): MtlsBanking {
  const agent = buildMtlsAgent();
  const baseURL = process.env.BANK_BASE_URL || process.env.MTLS_BANK_BASE_URL || "https://sandbox-bank";
  const timeoutMs = Number(process.env.BANK_TIMEOUT_MS || "10000");
  return new MtlsBanking({ baseURL, agent, timeoutMs });
}

export const banking: BankingPort = FEATURES.BANKING && hasMtlsMaterial() ? buildMtlsInstance() : new MockBanking();

export { BankingResponse } from "./MtlsBanking";
