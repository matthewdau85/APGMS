export type PeriodQuery = {
  abn: string;
  taxType: string;
  periodId: string;
};

export type BalanceResponse = PeriodQuery & {
  balance_cents: number;
  has_release: boolean;
};

export type LedgerRow = {
  id: number;
  amount_cents: number;
  balance_after_cents: number;
  bank_receipt_hash?: string | null;
  prev_hash?: string | null;
  hash_after?: string | null;
  created_at: string;
};

export type LedgerResponse = PeriodQuery & {
  rows: LedgerRow[];
};

export type EvidenceResponse = {
  meta: {
    generated_at: string;
    abn: string;
    taxType: string;
    periodId: string;
  };
  period: {
    state: string;
    accrued_cents: number;
    credited_to_owa_cents: number;
    final_liability_cents: number;
    merkle_root: string | null;
    running_balance_hash: string | null;
    anomaly_vector: Record<string, unknown> | null;
    thresholds: Record<string, unknown> | null;
  };
  rpt: null | {
    payload: unknown;
    payload_c14n: string;
    payload_sha256: string;
    signature: string;
    created_at?: string;
  };
  owa_ledger: LedgerRow[];
  bas_labels: Record<string, string | null>;
  discrepancy_log: unknown[];
};

export type ComplianceSnapshot = {
  lodgmentsUpToDate: boolean;
  paymentsUpToDate: boolean;
  overallCompliance: number;
  lastBAS: string;
  nextDue: string;
  outstandingLodgments: string[];
  outstandingAmounts: string[];
};
