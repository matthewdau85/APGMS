import { randomUUID } from "node:crypto";
import type { AxiosInstance } from "axios";
import CircuitBreaker from "opossum";
import type { CircuitBreakerOptions } from "opossum";
import type { BankingReceipt, BpayPaymentRequest } from "../bankingPort.js";
import { withExponentialBackoff } from "./common.js";

export interface RealBpayAdapterOptions {
  client: AxiosInstance;
  breaker?: CircuitBreakerOptions;
  dryRun: boolean;
  logger?: Pick<Console, "info" | "warn" | "error">;
}

export class RealBpayAdapter {
  private readonly breaker: CircuitBreaker<BpayPaymentRequest, BankingReceipt>;
  private readonly dryRun: boolean;
  private readonly logger?: Pick<Console, "info" | "warn" | "error">;

  constructor(private readonly opts: RealBpayAdapterOptions) {
    this.dryRun = opts.dryRun;
    this.logger = opts.logger;
    this.breaker = new CircuitBreaker(async (request: BpayPaymentRequest) => {
      return withExponentialBackoff(() => this.execute(request));
    }, { ...opts.breaker });
  }

  async send(request: BpayPaymentRequest): Promise<BankingReceipt> {
    if (this.dryRun) {
      const transferUuid = request.idempotencyKey || randomUUID();
      const bankReceiptId = `dry-run-${transferUuid}`;
      this.logger?.info?.(
        `[DRY_RUN] BPAY ${request.amountCents} cents to ${request.destination.billerCode}/${request.destination.crn}`
      );
      return { transferUuid, bankReceiptId, providerReceiptId: bankReceiptId };
    }
    return this.breaker.fire(request);
  }

  private async execute(request: BpayPaymentRequest): Promise<BankingReceipt> {
    const payload = {
      amount_cents: request.amountCents,
      idempotency_key: request.idempotencyKey,
      destination: {
        rail: "BPAY",
        biller_code: request.destination.billerCode,
        crn: request.destination.crn,
      },
      meta: request.metadata,
    };

    const response = await this.opts.client.post("/payments/bpay", payload);
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
