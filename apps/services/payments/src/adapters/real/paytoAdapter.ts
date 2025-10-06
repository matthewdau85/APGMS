import { randomUUID } from "node:crypto";
import type { AxiosInstance } from "axios";
import CircuitBreaker from "opossum";
import type { CircuitBreakerOptions } from "opossum";
import type {
  PayToCreateRequest,
  PayToMandateResponse,
  PayToVerifyResponse,
  PayToDebitRequest,
  PayToCancelResponse,
} from "../bankingPort.js";
import { withExponentialBackoff } from "./common.js";

export interface PayToDebitResult {
  status: string;
  bankReceiptId?: string;
  providerReceiptId?: string;
  [key: string]: unknown;
}

interface PayToAdapterOptions {
  client: AxiosInstance;
  breaker?: CircuitBreakerOptions;
  dryRun: boolean;
  logger?: Pick<Console, "info" | "warn" | "error">;
}

export class RealPayToAdapter {
  private readonly dryRun: boolean;
  private readonly logger?: Pick<Console, "info" | "warn" | "error">;
  private readonly createBreaker: CircuitBreaker<PayToCreateRequest, PayToMandateResponse>;
  private readonly verifyBreaker: CircuitBreaker<string, PayToVerifyResponse>;
  private readonly debitBreaker: CircuitBreaker<PayToDebitRequest, PayToDebitResult>;
  private readonly cancelBreaker: CircuitBreaker<string, PayToCancelResponse>;

  constructor(private readonly opts: PayToAdapterOptions) {
    this.dryRun = opts.dryRun;
    this.logger = opts.logger;
    this.createBreaker = new CircuitBreaker(async (request: PayToCreateRequest) => {
      return withExponentialBackoff(() => this.executeCreate(request));
    }, { ...opts.breaker });
    this.verifyBreaker = new CircuitBreaker(async (mandateId: string) => {
      return withExponentialBackoff(() => this.executeVerify(mandateId));
    }, { ...opts.breaker });
    this.debitBreaker = new CircuitBreaker(async (request: PayToDebitRequest) => {
      return withExponentialBackoff(() => this.executeDebit(request));
    }, { ...opts.breaker });
    this.cancelBreaker = new CircuitBreaker(async (mandateId: string) => {
      return withExponentialBackoff(() => this.executeCancel(mandateId));
    }, { ...opts.breaker });
  }

  async create(request: PayToCreateRequest): Promise<PayToMandateResponse> {
    if (this.dryRun) {
      const mandateId = `dry-run-mandate-${randomUUID()}`;
      this.logger?.info?.(`[DRY_RUN] PayTo create mandate for ${request.abn} cap ${request.capCents}`);
      return { mandateId, status: "DRY_RUN" };
    }
    return this.createBreaker.fire(request);
  }

  async verify(mandateId: string): Promise<PayToVerifyResponse> {
    if (this.dryRun) {
      this.logger?.info?.(`[DRY_RUN] PayTo verify mandate ${mandateId}`);
      return { mandateId, status: "DRY_RUN" };
    }
    return this.verifyBreaker.fire(mandateId);
  }

  async debit(request: PayToDebitRequest): Promise<PayToDebitResult> {
    if (this.dryRun) {
      const bankReceiptId = `dry-run-payto-${randomUUID()}`;
      this.logger?.info?.(`[DRY_RUN] PayTo debit ${request.amountCents} cents for mandate ${request.mandateId}`);
      return { status: "DRY_RUN", bankReceiptId, providerReceiptId: bankReceiptId };
    }
    return this.debitBreaker.fire(request);
  }

  async cancel(mandateId: string): Promise<PayToCancelResponse> {
    if (this.dryRun) {
      this.logger?.info?.(`[DRY_RUN] PayTo cancel mandate ${mandateId}`);
      return { mandateId, status: "DRY_RUN" };
    }
    return this.cancelBreaker.fire(mandateId);
  }

  private async executeCreate(request: PayToCreateRequest): Promise<PayToMandateResponse> {
    const payload = {
      abn: request.abn,
      period_id: request.periodId,
      cap_cents: request.capCents,
      meta: request.metadata,
    };
    const response = await this.opts.client.post("/payto/mandates", payload);
    const data = response.data ?? {};
    if (!data.mandate_id) {
      throw new Error("Bank response missing mandate_id");
    }
    return { mandateId: data.mandate_id, status: data.status ?? "OK", ...data };
  }

  private async executeVerify(mandateId: string): Promise<PayToVerifyResponse> {
    const response = await this.opts.client.post(`/payto/mandates/${mandateId}/verify`, {});
    const data = response.data ?? {};
    return { mandateId, status: data.status ?? "OK", ...data };
  }

  private async executeDebit(request: PayToDebitRequest): Promise<PayToDebitResult> {
    const payload = {
      amount_cents: request.amountCents,
      meta: request.metadata,
    };
    const response = await this.opts.client.post(`/payto/mandates/${request.mandateId}/debit`, payload);
    const data = response.data ?? {};
    return {
      status: data.status ?? "OK",
      bankReceiptId: data.bank_receipt_id || data.receipt_id,
      providerReceiptId: data.provider_receipt_id ?? data.bank_receipt_id ?? data.receipt_id,
      ...data,
    };
  }

  private async executeCancel(mandateId: string): Promise<PayToCancelResponse> {
    const response = await this.opts.client.post(`/payto/mandates/${mandateId}/cancel`, {});
    const data = response.data ?? {};
    return { mandateId, status: data.status ?? "OK", ...data };
  }
}
