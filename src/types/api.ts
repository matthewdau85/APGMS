export type AppQuery = {
  abn: string;
  taxType: string;
  periodId: string;
};

export type BalanceResponse = AppQuery & {
  balance_cents: number;
  has_release: boolean;
};

export type EvidenceLedgerDelta = {
  ts?: string;
  created_at?: string;
  amount_cents: number;
  hash_after?: string | null;
  bank_receipt_hash?: string | null;
};

export type EvidenceBundle = {
  bas_labels: Record<string, string | null>;
  rpt_payload: {
    amount_cents?: number;
    period_id?: string;
    anomaly_vector?: Record<string, number>;
    [key: string]: unknown;
  } | null;
  rpt_signature: string | null;
  owa_ledger_deltas?: EvidenceLedgerDelta[];
  bank_receipt_hash: string | null;
  anomaly_thresholds: Record<string, number>;
  discrepancy_log: Array<{ message?: string } & Record<string, unknown>>;
};

export type SettlementIngestResponse = {
  ingested: number;
};

export type ApiState<T> = {
  data: T | null;
  loading: boolean;
  error: string | null;
};
