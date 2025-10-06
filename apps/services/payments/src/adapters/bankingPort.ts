import type { PayToDebitResult } from "./real/paytoAdapter.js";

export interface PaymentRequestBase {
  abn: string;
  taxType: string;
  periodId: string;
  amountCents: number;
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
}

export interface EftDestination {
  rail: "EFT";
  bsb: string;
  accountNumber: string;
  accountName?: string;
}

export interface BpayDestination {
  rail: "BPAY";
  billerCode: string;
  crn: string;
}

export type PaymentDestination = EftDestination | BpayDestination;

export interface EftPaymentRequest extends PaymentRequestBase {
  destination: EftDestination;
}

export interface BpayPaymentRequest extends PaymentRequestBase {
  destination: BpayDestination;
}

export interface BankingReceipt {
  transferUuid: string;
  bankReceiptId: string;
  providerReceiptId?: string;
}

export interface PayToCreateRequest {
  abn: string;
  periodId: string;
  capCents: number;
  metadata?: Record<string, unknown>;
}

export interface PayToMandateResponse {
  mandateId: string;
  status: string;
  [key: string]: unknown;
}

export interface PayToVerifyResponse {
  mandateId: string;
  status: string;
  [key: string]: unknown;
}

export interface PayToDebitRequest {
  mandateId: string;
  amountCents: number;
  metadata?: Record<string, unknown>;
}

export interface PayToCancelResponse {
  mandateId: string;
  status: string;
  [key: string]: unknown;
}

export interface BankingPort {
  sendEft(request: EftPaymentRequest): Promise<BankingReceipt>;
  sendBpay(request: BpayPaymentRequest): Promise<BankingReceipt>;
  createPayToMandate(request: PayToCreateRequest): Promise<PayToMandateResponse>;
  verifyPayToMandate(mandateId: string): Promise<PayToVerifyResponse>;
  debitPayToMandate(request: PayToDebitRequest): Promise<PayToDebitResult>;
  cancelPayToMandate(mandateId: string): Promise<PayToCancelResponse>;
}
