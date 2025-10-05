export interface PayCommand {
  amount: number;
  currency: string;
  reference?: string;
  metadata?: Record<string, unknown>;
}

export interface PaymentRecord {
  id: string;
  amount: number;
  currency: string;
  reference?: string;
  metadata?: Record<string, unknown>;
  status: "pending" | "settled" | "refunded" | "failed";
  provider: string;
  createdAt: string;
  updatedAt: string;
}

export interface RefundCommand {
  paymentId: string;
  amount?: number;
  reason?: string;
  metadata?: Record<string, unknown>;
}

export interface RefundReceipt {
  id: string;
  paymentId: string;
  provider: string;
  status: "accepted" | "rejected";
  processedAt: string;
  metadata?: Record<string, unknown>;
}

export interface BankPort {
  readonly providerName: string;
  pay(command: PayCommand): Promise<PaymentRecord>;
  getPayment(id: string): Promise<PaymentRecord | undefined>;
  refund(command: RefundCommand): Promise<RefundReceipt>;
}

export interface KmsPort {
  readonly providerName: string;
  getKeyId(): string;
  sign(payload: string): Promise<string>;
  verify(payload: string, signature: string): Promise<boolean>;
}

export interface RatesPort {
  readonly providerName: string;
  getRate(code: string): Promise<number>;
  listRates(): Promise<Record<string, number>>;
}

export interface StatementsPort {
  readonly providerName: string;
  generateStatement(accountId: string, options?: Record<string, unknown>): Promise<{ id: string; provider: string; generatedAt: string; metadata?: Record<string, unknown>; }>;
}

export interface AnomalyPort {
  readonly providerName: string;
  detect(payload: Record<string, unknown>): Promise<{ anomalies: Array<{ message: string; score: number }> }>;
  mode(): "shadow" | "active";
}

export interface FeatureFlags {
  protoKillSwitch: boolean;
  shadowMode: boolean;
}

export type ProviderBindings = {
  bank: BankPort;
  kms: KmsPort;
  rates: RatesPort;
  statements: StatementsPort;
  anomaly: AnomalyPort;
};

export type ProviderSelection = {
  [K in keyof ProviderBindings]: string;
};
