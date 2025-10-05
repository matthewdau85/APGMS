import type { ContractErrorShape } from "./types";

export interface BasePort {
  timeoutMs: number;
  retriableCodes: string[];
}

export interface BankTransferRequest {
  abn: string;
  amountCents: number;
  reference: string;
}

export interface BankTransferResponse {
  transferId: string;
  status: "ACCEPTED" | "REJECTED";
  receipt: {
    provider: string;
    issuedAt: string;
    reference: string;
  };
}

export interface BankPort extends BasePort {
  initiateTransfer(request: BankTransferRequest): Promise<BankTransferResponse>;
  idempotencyKey(request: BankTransferRequest): string;
  simulateError(kind: "insufficient_funds" | "timeout" | "network"): Promise<ContractErrorShape>;
}

export interface KmsPort extends BasePort {
  keyId: string;
  sign(payload: Uint8Array): Promise<Uint8Array>;
  verify(payload: Uint8Array, signature: Uint8Array): Promise<boolean>;
  simulateError(kind: "bad_key" | "timeout"): Promise<ContractErrorShape>;
}

export interface RateBracket {
  threshold: number;
  rate: number;
}

export interface RatesPort extends BasePort {
  fetchRates(input: { region: string; taxYear: number }): Promise<{ version: string; brackets: RateBracket[] }>;
  simulateError(kind: "not_found" | "timeout"): Promise<ContractErrorShape>;
  idempotencyKey(input: { region: string; taxYear: number }): string;
}

export interface IdpPort extends BasePort {
  authenticate(credentials: { username: string; password: string }): Promise<{ token: string; expiresAt: string }>;
  refresh(token: string): Promise<{ token: string; expiresAt: string }>;
  simulateError(kind: "unauthorized" | "timeout"): Promise<ContractErrorShape>;
  idempotencyKey(credentials: { username: string; password: string }): string;
}

export interface StatementSummary {
  statementId: string;
  abn: string;
  period: string;
  amountCents: number;
}

export interface StatementsPort extends BasePort {
  fetchLatest(abn: string): Promise<StatementSummary>;
  acknowledge(statementId: string): Promise<{ acknowledged: boolean; ackId: string }>;
  simulateError(kind: "not_found" | "timeout"): Promise<ContractErrorShape>;
  idempotencyKey(statementId: string): string;
}

export interface AnomalyVector {
  variance_ratio: number;
  dup_rate: number;
  gap_minutes: number;
  delta_vs_baseline: number;
}

export interface AnomalyPort extends BasePort {
  evaluate(vector: AnomalyVector): Promise<{ anomalous: boolean; score: number }>;
  thresholds(): Record<string, number>;
  simulateError(kind: "invalid" | "timeout"): Promise<ContractErrorShape>;
  idempotencyKey(vector: AnomalyVector): string;
}
