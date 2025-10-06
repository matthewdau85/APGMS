import type { IncomingHttpHeaders } from "http";

export type Rail = "EFT" | "BPAY";

export interface ReleaseBase {
  abn: string;
  periodId: string;
  taxType: string;
  amountCents: number;
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
  headers?: IncomingHttpHeaders;
}

export interface EftReleaseRequest extends ReleaseBase {
  rail: "EFT";
  destination: {
    bsb: string;
    accountNumber: string;
    accountName?: string;
    lodgementReference?: string;
  };
}

export interface BpayReleaseRequest extends ReleaseBase {
  rail: "BPAY";
  destination: {
    billerCode: string;
    crn: string;
  };
}

export type ReleaseRequest = EftReleaseRequest | BpayReleaseRequest;

export interface ReleaseResponse {
  providerRef: string;
  paidAt?: string | null;
  receipt?: unknown;
}

export interface ReceiptResponse {
  providerRef: string;
  paidAt?: string | null;
  amountCents?: number;
  rail?: Rail;
  raw: unknown;
}

export interface BankingPort {
  eftRelease(request: EftReleaseRequest): Promise<ReleaseResponse>;
  bpayRelease(request: BpayReleaseRequest): Promise<ReleaseResponse>;
  fetchReceipt(providerRef: string): Promise<ReceiptResponse>;
}

export class BankingError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "BankingError";
    this.status = status;
  }
}
