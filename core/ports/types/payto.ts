export type MandateStatus = "PENDING" | "ACTIVE" | "VERIFIED" | "CANCELLED";

export interface PayToMandate {
  id: string;
  abn: string;
  periodId: string;
  capCents: number;
  status: MandateStatus;
}

export interface PayToOperationResult<T = unknown> {
  ok: boolean;
  code?: string;
  mandate?: PayToMandate;
  data?: T;
}

export interface PayToDebitResult {
  ok: boolean;
  code?: string;
  bankRef?: string;
}

export interface PayToPort {
  createMandate(input: { abn: string; periodId: string; capCents: number }): Promise<PayToOperationResult>;
  verifyMandate(mandateId: string): Promise<PayToOperationResult>;
  debitMandate(mandateId: string, amountCents: number, metadata?: Record<string, unknown>): Promise<PayToDebitResult>;
  cancelMandate(mandateId: string): Promise<PayToOperationResult>;
}
