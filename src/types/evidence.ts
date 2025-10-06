export type LedgerEntryProof = {
  id: number;
  transfer_uuid: string | null;
  amount_cents: number;
  balance_after_cents: number;
  bank_receipt_hash: string | null;
  prev_hash: string | null;
  hash_after: string | null;
  created_at: string;
};

export type EvidenceReceipt = {
  id: string | null;
  channel: string | null;
  provider_ref: string | null;
  dry_run: boolean;
};

export type EvidenceDetails = {
  period_summary: {
    labels: Record<string, unknown>;
    totals: {
      accrued_cents: number | null;
      credited_to_owa_cents: number | null;
      final_liability_cents: number | null;
    };
    rates_version: string | null;
  };
  rpt: {
    payload: Record<string, unknown> | null;
    signature: string | null;
    key_id: string | null;
  };
  ledger_proofs: {
    merkle_root: string | null;
    running_balance_hash: string | null;
    last_entries: LedgerEntryProof[];
  };
  receipt: EvidenceReceipt;
};

export type EvidenceBundle = {
  abn: string;
  tax_type: string;
  period_id: string;
  generated_at: string;
  details: EvidenceDetails;
};
