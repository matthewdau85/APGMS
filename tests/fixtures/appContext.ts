import type { BalanceResponse, EvidenceBundle } from "../../src/types/api";
import type { BASHistory } from "../../src/types/tax";
import { parsePeriodId } from "../../src/utils/period";

export const sampleQuery = {
  abn: "12345678901",
  taxType: "GST",
  periodId: "2025Q2",
};

export const sampleBalance: BalanceResponse = {
  ...sampleQuery,
  balance_cents: 0,
  has_release: true,
};

export const sampleEvidence: EvidenceBundle = {
  bas_labels: { W1: null, W2: null, "1A": null, "1B": null },
  rpt_payload: {
    period_id: sampleQuery.periodId,
    amount_cents: 123456,
    anomaly_vector: {
      dup_rate: 0.002,
      gap_minutes: 10,
      variance_ratio: 0.1,
      delta_vs_baseline: 0.05,
    },
  },
  rpt_signature: "demo-signature",
  owa_ledger_deltas: [
    {
      ts: new Date("2025-04-15T10:00:00Z").toISOString(),
      amount_cents: 60000,
      hash_after: "hash1",
    },
    {
      ts: new Date("2025-05-10T10:00:00Z").toISOString(),
      amount_cents: 63456,
      hash_after: "hash2",
    },
    {
      ts: new Date("2025-05-31T23:30:00Z").toISOString(),
      amount_cents: -123456,
      hash_after: "hash3",
    },
  ],
  bank_receipt_hash: "bank-receipt",
  anomaly_thresholds: {
    dup_rate: 0.01,
    gap_minutes: 60,
    variance_ratio: 0.25,
    delta_vs_baseline: 0.2,
  },
  discrepancy_log: [],
};

export const sampleBasHistory: BASHistory[] = [
  {
    period: parsePeriodId(sampleQuery.periodId),
    paygwPaid: 0,
    gstPaid: (sampleEvidence.rpt_payload?.amount_cents ?? 0) / 100,
    status: "On Time",
    daysLate: 0,
    penalties: 0,
  },
];

export const sampleAuditLog = [
  { timestamp: Date.now(), action: "Sample RPT issued", user: "System" },
];

export const sampleInitialState = {
  query: sampleQuery,
  balance: sampleBalance,
  evidence: sampleEvidence,
  basHistory: sampleBasHistory,
  auditLog: sampleAuditLog,
};
