import { useCallback, useEffect, useMemo, useState } from "react";
import { Payments } from "../../libs/paymentsClient";

export type PeriodQuery = { abn: string; taxType: string; periodId: string };

export type BalanceResponse = {
  abn: string;
  taxType: string;
  periodId: string;
  balance_cents: number;
  has_release: boolean;
};

export type LedgerRow = {
  id: string | number;
  amount_cents: number;
  balance_after_cents: number;
  rpt_verified?: boolean | null;
  release_uuid?: string | null;
  bank_receipt_id?: string | null;
  created_at?: string;
};

export type LedgerResponse = {
  abn: string;
  taxType: string;
  periodId: string;
  rows: LedgerRow[];
};

export type EvidenceResponse = {
  bas_labels?: Record<string, string | number | null>;
  rpt_payload?: {
    period_id?: string;
    amount_cents?: number;
    anomaly_vector?: Record<string, number>;
    [key: string]: unknown;
  } | null;
  rpt_signature?: string | null;
  owa_ledger_deltas?: Array<{
    ts: string;
    amount_cents: number;
    hash_after?: string | null;
    bank_receipt_hash?: string | null;
  }>;
  bank_receipt_hash?: string | null;
  anomaly_thresholds?: Record<string, number>;
  discrepancy_log?: Array<{ message?: string } | string>;
  [key: string]: unknown;
};

export type ComplianceSummary = {
  lodgmentsUpToDate: boolean;
  paymentsUpToDate: boolean;
  overallCompliance: number;
  outstandingLodgments: string[];
  outstandingAmounts: string[];
  lastBAS?: string;
  nextDue?: string;
  alerts: string[];
};

export type LedgerTotals = {
  totalDepositsCents: number;
  totalReleasesCents: number;
};

export const DEFAULT_PERIOD: PeriodQuery = {
  abn: "12345678901",
  taxType: "GST",
  periodId: "2025-09",
};

function normaliseLedgerRows(rows: LedgerResponse["rows"] | undefined): LedgerRow[] {
  if (!rows) return [];
  return rows.map((row) => ({
    ...row,
    amount_cents: typeof row.amount_cents === "number" ? row.amount_cents : Number(row.amount_cents || 0),
    balance_after_cents:
      typeof row.balance_after_cents === "number" ? row.balance_after_cents : Number(row.balance_after_cents || 0),
  }));
}

function calculateLedgerTotals(rows: LedgerRow[]): LedgerTotals {
  return rows.reduce(
    (acc, row) => {
      if (row.amount_cents >= 0) {
        acc.totalDepositsCents += row.amount_cents;
      } else {
        acc.totalReleasesCents += Math.abs(row.amount_cents);
      }
      return acc;
    },
    { totalDepositsCents: 0, totalReleasesCents: 0 }
  );
}

function formatCurrency(cents: number): string {
  return (cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function monthNameFromPeriod(periodId: string): string | undefined {
  const [y, m] = periodId.split("-").map((part) => Number(part));
  if (!y || !m) return undefined;
  const date = new Date(y, m - 1, 1);
  return date.toLocaleDateString(undefined, { month: "short", year: "numeric" });
}

function nextDueFromPeriod(periodId: string): string | undefined {
  const [y, m] = periodId.split("-").map((part) => Number(part));
  if (!y || !m) return undefined;
  const due = new Date(y, m, 28);
  return due.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function buildAlerts(evidence: EvidenceResponse | null | undefined): string[] {
  if (!evidence) return [];
  const thresholds =
    (evidence.anomaly_thresholds as Record<string, number> | undefined) ||
    ((evidence as any).period?.thresholds as Record<string, number> | undefined);
  const vector =
    (evidence.rpt_payload?.anomaly_vector as Record<string, number> | undefined) ||
    ((evidence as any).period?.anomaly_vector as Record<string, number> | undefined);

  const alerts: string[] = [];
  if (!thresholds || !vector) return alerts;

  Object.entries(vector).forEach(([key, value]) => {
    const threshold = thresholds[key];
    if (typeof value === "number" && typeof threshold === "number" && value > threshold) {
      alerts.push(`${key.replace(/_/g, " ")} exceeded threshold (${value} > ${threshold})`);
    }
  });

  const discrepancyLog = Array.isArray(evidence.discrepancy_log) ? evidence.discrepancy_log : [];
  discrepancyLog.forEach((entry) => {
    if (!entry) return;
    if (typeof entry === "string") {
      alerts.push(entry);
    } else if (typeof entry === "object" && "message" in entry && entry.message) {
      alerts.push(String(entry.message));
    }
  });

  return alerts;
}

export function buildComplianceSummary(
  query: PeriodQuery,
  balance: BalanceResponse | null,
  ledgerRows: LedgerRow[],
  evidence: EvidenceResponse | null
): ComplianceSummary {
  const outstandingAmounts: string[] = [];
  const outstandingCents = balance?.balance_cents ?? 0;
  if (outstandingCents > 0) {
    outstandingAmounts.push(`$${formatCurrency(outstandingCents)}`);
  }

  const lodgmentsUpToDate = Boolean(evidence?.rpt_payload);
  const paymentsUpToDate = outstandingCents <= 0;

  let overallCompliance = 100;
  if (!lodgmentsUpToDate) overallCompliance -= 40;
  if (!paymentsUpToDate) overallCompliance -= 40;

  const alerts = buildAlerts(evidence);
  overallCompliance -= alerts.length * 5;
  overallCompliance = Math.max(0, Math.min(100, Math.round(overallCompliance)));

  const releaseEntry = [...ledgerRows].reverse().find((row) => row.amount_cents < 0);
  const lastBASDate = releaseEntry?.created_at
    ? new Date(releaseEntry.created_at).toLocaleDateString(undefined, {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : undefined;

  return {
    lodgmentsUpToDate,
    paymentsUpToDate,
    overallCompliance,
    outstandingLodgments: lodgmentsUpToDate ? [] : [monthNameFromPeriod(query.periodId) ?? query.periodId],
    outstandingAmounts,
    lastBAS: lastBASDate ?? (lodgmentsUpToDate ? monthNameFromPeriod(query.periodId) : undefined),
    nextDue: nextDueFromPeriod(query.periodId),
    alerts,
  };
}

export function usePeriodData(query: PeriodQuery) {
  const [balance, setBalance] = useState<BalanceResponse | null>(null);
  const [ledger, setLedger] = useState<LedgerRow[]>([]);
  const [evidence, setEvidence] = useState<EvidenceResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [balanceRes, ledgerRes, evidenceRes] = await Promise.all([
        Payments.balance(query),
        Payments.ledger(query),
        Payments.evidence(query),
      ]);

      setBalance(balanceRes as BalanceResponse);
      setLedger(normaliseLedgerRows((ledgerRes as LedgerResponse)?.rows));
      setEvidence(evidenceRes as EvidenceResponse);
    } catch (err: any) {
      setError(err?.message || "Unable to load period data");
      setBalance(null);
      setLedger([]);
      setEvidence(null);
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const totals = useMemo(() => calculateLedgerTotals(ledger), [ledger]);

  return {
    balance,
    ledger,
    evidence,
    totals,
    error,
    isLoading: loading,
    refresh: fetchData,
  };
}

export function centsToDollars(cents: number | null | undefined) {
  if (cents === null || cents === undefined) return null;
  return cents / 100;
}

export function formatCurrencyFromCents(cents: number | null | undefined) {
  if (cents === null || cents === undefined) return "-";
  return `$${formatCurrency(cents)}`;
}
