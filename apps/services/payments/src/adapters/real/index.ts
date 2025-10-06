import type { BankingPort, BpayPaymentRequest, EftPaymentRequest, PayToCreateRequest, PayToDebitRequest } from "../bankingPort.js";
import type { CircuitBreakerOptions } from "opossum";
import { createHttpClient, isDryRunEnabled, sanitizeBaseUrl } from "./common.js";
import { RealEftAdapter } from "./eftAdapter.js";
import { RealBpayAdapter } from "./bpayAdapter.js";
import { RealPayToAdapter, PayToDebitResult } from "./paytoAdapter.js";

export interface RealBankingPortOptions {
  baseUrl?: string;
  timeoutMs?: number;
  dryRun?: boolean;
  logger?: Pick<Console, "info" | "warn" | "error">;
  breaker?: CircuitBreakerOptions;
}

export function createRealBankingPort(options: RealBankingPortOptions = {}): BankingPort {
  const baseUrl = sanitizeBaseUrl(options.baseUrl ?? process.env.BANK_API_BASE);
  const timeoutMs = options.timeoutMs ?? Number(process.env.BANK_TIMEOUT_MS ?? "8000");
  const dryRun = options.dryRun ?? isDryRunEnabled(process.env.DRY_RUN);
  const logger = options.logger ?? console;
  const client = createHttpClient({
    baseUrl,
    timeoutMs,
    dryRun,
    logger,
    caPath: process.env.MTLS_CA,
    certPath: process.env.MTLS_CERT,
    keyPath: process.env.MTLS_KEY,
  });

  const breakerOptions = options.breaker;
  const eft = new RealEftAdapter({ client, dryRun, logger, breaker: breakerOptions });
  const bpay = new RealBpayAdapter({ client, dryRun, logger, breaker: breakerOptions });
  const payto = new RealPayToAdapter({ client, dryRun, logger, breaker: breakerOptions });

  return {
    async sendEft(request: EftPaymentRequest) {
      return eft.send(request);
    },
    async sendBpay(request: BpayPaymentRequest) {
      return bpay.send(request);
    },
    async createPayToMandate(request: PayToCreateRequest) {
      return payto.create(request);
    },
    async verifyPayToMandate(mandateId: string) {
      return payto.verify(mandateId);
    },
    async debitPayToMandate(request: PayToDebitRequest): Promise<PayToDebitResult> {
      return payto.debit(request);
    },
    async cancelPayToMandate(mandateId: string) {
      return payto.cancel(mandateId);
    },
  };
}
