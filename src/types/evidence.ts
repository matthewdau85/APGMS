export interface LedgerEntry {
  id: number;
  transfer_uuid: string | null;
  amount_cents: number;
  balance_after_cents: number;
  bank_receipt_hash: string | null;
  prev_hash: string | null;
  hash_after: string | null;
  created_at: string;
}

export interface PeriodTotals {
  accrued_cents: number;
  credited_to_owa_cents: number;
  final_liability_cents: number;
}

export interface PeriodSummary {
  state: string;
  totals: PeriodTotals;
  labels: Record<string, number | null>;
  anomaly_vector: Record<string, unknown>;
  thresholds: Record<string, unknown>;
  rates_version: string;
}

export interface EvidenceReceipt {
  id: string | null;
  channel: string | null;
  provider_ref: string | null;
  dry_run: boolean;
  raw?: string | null;
}

export interface EvidenceBundle {
  abn: string;
  tax_type: string;
  period_id: string;
  generated_at: string;
  rates_version: string;
  period_summary: PeriodSummary;
  ledger_proof: {
    merkle_root: string | null;
    running_balance_hash: string | null;
    entry_count: number;
    entries: LedgerEntry[];
  };
  rpt: {
    payload: Record<string, unknown>;
    signature: string;
    public_key_id: string;
  } | null;
  receipt: EvidenceReceipt;
}
