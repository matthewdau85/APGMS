export type RPT = {
  rpt_id: string;
  kid?: string;
  payload_sha256: string;
  [key: string]: unknown;
};

export type PayoutReference = {
  abn?: string;
  taxType?: string;
  periodId?: string;
  ledgerId?: string;
  [key: string]: unknown;
};

export type PayoutResult = {
  transferUuid: string;
  bankReceiptHash: string;
  providerReceiptId: string;
  rawResponse?: unknown;
};

export interface BankEgressPort {
  payout(rpt: RPT, amount_cents: number, ref: PayoutReference): Promise<PayoutResult>;
}

export type StatementRecord = {
  statementId: string;
  amount_cents: number;
  reference?: string;
  issued_at?: string;
  metadata?: Record<string, unknown>;
};

export type IngestResult = {
  recordsIngested: number;
  discarded: number;
  batchId: string;
  metadata?: Record<string, unknown>;
};

export interface BankStatementsPort {
  ingest(csv: string | Buffer): Promise<IngestResult>;
  listUnreconciled(): Promise<StatementRecord[]>;
}

export type CompactJWS = string;

export type JwksResult = {
  keys: Array<Record<string, unknown>>;
};

export interface KmsPort {
  signJWS(payload: Record<string, unknown> | string | Buffer): Promise<CompactJWS>;
  rotate(): Promise<void>;
  jwks(): Promise<JwksResult>;
  verify?(payload: Buffer | string, signature: Buffer | string): Promise<boolean>;
}

export type RatesVersion = {
  effectiveDate: string;
  updatedAt: string;
  rates: Record<string, number>;
};

export interface RatesPort {
  currentFor(date: Date | string): Promise<RatesVersion>;
  listVersions(): Promise<RatesVersion[]>;
}

export type IdentityCredentials = Record<string, unknown>;

export type Identity = {
  id: string;
  claims: Record<string, unknown>;
};

export interface IdentityPort {
  authenticate(credentials: IdentityCredentials): Promise<Identity | null>;
  authorize(identity: Identity, resource: string, action: string): Promise<boolean>;
}

export type AnomalyDecision = "allow" | "review" | "block";

export type AnomalyScore = {
  decision: AnomalyDecision;
  score: number;
  metadata?: Record<string, unknown>;
};

export interface AnomalyPort {
  score(payload: Record<string, unknown>): Promise<AnomalyScore>;
}
