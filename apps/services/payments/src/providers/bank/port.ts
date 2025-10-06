
export type RailCode = "EFT" | "BPAY" | "PAYTO";

export type PayoutRequest = {
  abn: string;
  taxType: string;
  periodId: string;
  amountCents: number;
  currency?: string;
  rail: RailCode;
  reference: string;
  idempotencyKey: string;
  metadata?: Record<string, any>;
};

export type PayoutResultStatus = "ACCEPTED" | "PENDING" | "REJECTED";

export type PayoutResult = {
  status: PayoutResultStatus;
  provider_code: string;
  reference: string;
  bank_txn_id?: string;
  raw?: Record<string, any>;
};

export interface BankEgressPort {
  submitPayout(request: PayoutRequest): Promise<PayoutResult>;
}

export type BankStatementEntry = {
  bank_txn_id: string;
  posted_at: string;
  amount_cents: number;
  reference: string;
  description?: string;
  provider_code?: string;
};

export type BankStatementBatch = {
  provider: string;
  cutoff: string;
  entries: BankStatementEntry[];
  raw: string;
  source: string;
};

export type StatementIngestPayload = {
  filename?: string;
  contentType?: string;
  body: string | Buffer;
};

export interface BankStatementsPort {
  register(handler: (batch: BankStatementBatch) => Promise<void> | void): void;
  start(): Promise<void>;
  stop(): Promise<void>;
  ingestHttp(payload: StatementIngestPayload): Promise<void>;
}

export type BankProvider = {
  egress: BankEgressPort;
  statements: BankStatementsPort;
};
