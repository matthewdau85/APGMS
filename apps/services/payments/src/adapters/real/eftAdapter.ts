import { randomUUID } from "node:crypto";
import type { AxiosInstance } from "axios";
import CircuitBreaker from "opossum";
import type { CircuitBreakerOptions } from "opossum";
import type { BankingReceipt, EftPaymentRequest } from "../bankingPort.js";
import { withExponentialBackoff } from "./common.js";

export interface RealEftAdapterOptions {
  client: AxiosInstance;
  breaker?: CircuitBreakerOptions;
  dryRun: boolean;
  logger?: Pick<Console, "info" | "warn" | "error">;
}

export class RealEftAdapter {
  private readonly breaker: CircuitBreaker<EftPaymentRequest, BankingReceipt>;
  private readonly dryRun: boolean;
  private readonly logger?: Pick<Console, "info" | "warn" | "error">;

  constructor(private readonly opts: RealEftAdapterOptions) {
    this.dryRun = opts.dryRun;
    this.logger = opts.logger;
    this.breaker = new CircuitBreaker(async (request: EftPaymentRequest) => {
      return withExponentialBackoff(() => this.execute(request));
    }, { ...opts.breaker });
  }

  async send(request: EftPaymentRequest): Promise<BankingReceipt> {
    if (this.dryRun) {
      const transferUuid = request.idempotencyKey || randomUUID();
      const bankReceiptId = `dry-run-${transferUuid}`;
      this.logger?.info?.(
        `[DRY_RUN] EFT ${request.amountCents} cents to ${request.destination.bsb}/${request.destination.accountNumber}`
      );
      return { transferUuid, bankReceiptId, providerReceiptId: bankReceiptId };
    }
    return this.breaker.fire(request);
  }

  private async execute(request: EftPaymentRequest): Promise<BankingReceipt> {
    const payload = {
      amount_cents: request.amountCents,
      idempotency_key: request.idempotencyKey,
      destination: {
        rail: "EFT",
        bsb: request.destination.bsb,
        account_number: request.destination.accountNumber,
        account_name: request.destination.accountName,
      },
      meta: request.metadata,
    };

    const response = await this.opts.client.post("/payments/eft", payload);
    const data = response.data ?? {};
    const transferUuid: string = data.transfer_uuid ?? request.idempotencyKey ?? randomUUID();
    const bankReceiptId: string = data.bank_receipt_id || data.receipt_id;
    if (!bankReceiptId) {
      throw new Error("Bank response missing bank_receipt_id");
    }
    return {
      transferUuid,
      bankReceiptId,
      providerReceiptId: data.provider_receipt_id ?? bankReceiptId,
    };
  }
}
