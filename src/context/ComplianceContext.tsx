import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

export interface ComplianceSelection {
  abn: string;
  taxType: string;
  periodId: string;
}

export interface BalanceResponse {
  abn: string;
  taxType: string;
  periodId: string;
  balance_cents?: number;
  has_release?: boolean;
  [key: string]: unknown;
}

export interface LedgerEntry {
  id: number | string;
  amount_cents: number;
  balance_after_cents?: number;
  created_at?: string;
  [key: string]: unknown;
}

export interface LedgerResponse {
  abn: string;
  taxType: string;
  periodId: string;
  rows: LedgerEntry[];
  [key: string]: unknown;
}

export interface EvidencePayload {
  period_id?: string;
  amount_cents?: number;
  tax_type?: string;
  expiry_ts?: string;
  created_at?: string;
  [key: string]: unknown;
}

export interface EvidenceResponse {
  rpt_payload?: EvidencePayload | null;
  rpt_signature?: string | null;
  owa_ledger_deltas?: Array<{ created_at?: string | null } & Record<string, unknown>> | null;
  bas_labels?: Record<string, string | null> | null;
  bank_receipt_hash?: string | null;
  anomaly_thresholds?: Record<string, unknown> | null;
  discrepancy_log?: unknown[] | null;
  [key: string]: unknown;
}

export interface ComplianceSummary {
  lodgmentsUpToDate: boolean;
  paymentsUpToDate: boolean;
  overallCompliance: number;
  lastBAS: string;
  nextDue: string;
  outstandingLodgments: string[];
  outstandingAmounts: string[];
  outstandingPaymentCents: number;
  totalDepositedCents: number;
  totalReleasedCents: number;
  requiredPaymentCents: number;
}

export interface ComplianceSnapshot {
  status: "idle" | "loading" | "success" | "error";
  error: string | null;
  summary: ComplianceSummary | null;
  raw: {
    balance?: BalanceResponse;
    ledger?: LedgerResponse;
    evidence?: EvidenceResponse;
  };
}

export interface ComplianceClient {
  balance(selection: ComplianceSelection): Promise<BalanceResponse>;
  ledger(selection: ComplianceSelection): Promise<LedgerResponse>;
  evidence(selection: ComplianceSelection): Promise<EvidenceResponse>;
}

export interface ComplianceProviderProps {
  children: React.ReactNode;
  client?: ComplianceClient;
  initialSelection?: ComplianceSelection;
}

interface ComplianceContextValue {
  selection: ComplianceSelection;
  setSelection: (update: Partial<ComplianceSelection>) => void;
  refresh: () => Promise<void>;
  snapshot: ComplianceSnapshot;
}

const ComplianceContext = createContext<ComplianceContextValue | undefined>(undefined);

const DEFAULT_SELECTION: ComplianceSelection = {
  abn: "12345678901",
  taxType: "GST",
  periodId: "2025-09",
};

function formatDate(value?: string | null): string {
  if (!value) {
    return "N/A";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleDateString("en-AU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function centsToCurrency(cents: number, currency: string = "AUD"): string {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(cents / 100);
}

export function normalizeCompliance(
  balance: BalanceResponse,
  ledger: LedgerResponse,
  evidence: EvidenceResponse,
  selection: ComplianceSelection,
): ComplianceSummary {
  const rows = Array.isArray(ledger?.rows) ? ledger.rows : [];
  const totalDepositedCents = rows.reduce((acc, row) => {
    const amount = Number(row.amount_cents ?? 0);
    return amount > 0 ? acc + amount : acc;
  }, 0);
  const totalReleasedCents = rows.reduce((acc, row) => {
    const amount = Number(row.amount_cents ?? 0);
    return amount < 0 ? acc + Math.abs(amount) : acc;
  }, 0);

  const requiredPaymentCents = Number(evidence?.rpt_payload?.amount_cents ?? 0);
  const outstandingPaymentCents = Math.max(requiredPaymentCents - totalReleasedCents, 0);

  const lodgmentsUpToDate = Boolean(evidence?.rpt_payload && evidence?.rpt_signature);
  const paymentsUpToDate = outstandingPaymentCents === 0 || Boolean(balance?.has_release);

  const coverageRatio = requiredPaymentCents > 0
    ? Math.min(totalDepositedCents / requiredPaymentCents, 1)
    : 1;

  const paymentScore = paymentsUpToDate ? 50 : Math.round(50 * coverageRatio);
  const lodgingScore = lodgmentsUpToDate ? 50 : 10;
  const overallCompliance = Math.max(0, Math.min(100, paymentScore + lodgingScore));

  const lastLedgerEntry = rows.length > 0 ? rows[rows.length - 1] : null;
  const deltas = Array.isArray(evidence?.owa_ledger_deltas)
    ? (evidence?.owa_ledger_deltas as Array<{ created_at?: string | null }>)
    : [];
  const lastDelta = deltas.length > 0 ? deltas[deltas.length - 1] : null;
  const lastBASDate = lastLedgerEntry?.created_at
    || evidence?.rpt_payload?.created_at
    || (lastDelta?.created_at ?? null);

  const nextDueDate = evidence?.rpt_payload?.expiry_ts ?? null;

  const outstandingAmounts = outstandingPaymentCents > 0
    ? [
        `${centsToCurrency(outstandingPaymentCents)} ${
          evidence?.rpt_payload?.tax_type || selection.taxType
        }`,
      ]
    : [];

  const outstandingLodgments = lodgmentsUpToDate ? [] : [selection.periodId];

  return {
    lodgmentsUpToDate,
    paymentsUpToDate,
    overallCompliance,
    lastBAS: formatDate(lastBASDate),
    nextDue: formatDate(nextDueDate),
    outstandingLodgments,
    outstandingAmounts,
    outstandingPaymentCents,
    totalDepositedCents,
    totalReleasedCents,
    requiredPaymentCents,
  };
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (error) {
    throw new Error(`Failed to parse response from ${url}`);
  }
  if (!res.ok) {
    const message = data?.error || data?.detail || text || `Request failed with ${res.status}`;
    throw new Error(String(message));
  }
  return data as T;
}

const defaultClient: ComplianceClient = {
  async balance(selection) {
    const params = new URLSearchParams(selection as Record<string, string>);
    return fetchJson<BalanceResponse>(`/api/balance?${params.toString()}`);
  },
  async ledger(selection) {
    const params = new URLSearchParams(selection as Record<string, string>);
    return fetchJson<LedgerResponse>(`/api/ledger?${params.toString()}`);
  },
  async evidence(selection) {
    const params = new URLSearchParams(selection as Record<string, string>);
    return fetchJson<EvidenceResponse>(`/api/evidence?${params.toString()}`);
  },
};

export function ComplianceProvider({
  children,
  client = defaultClient,
  initialSelection = DEFAULT_SELECTION,
}: ComplianceProviderProps) {
  const [selection, setSelectionState] = useState<ComplianceSelection>(initialSelection);
  const [snapshot, setSnapshot] = useState<ComplianceSnapshot>({
    status: "idle",
    error: null,
    summary: null,
    raw: {},
  });

  const load = useCallback(
    async (current: ComplianceSelection) => {
      setSnapshot((prev) => ({ ...prev, status: "loading", error: null }));
      try {
        const [balance, ledger, evidence] = await Promise.all([
          client.balance(current),
          client.ledger(current),
          client.evidence(current),
        ]);
        const summary = normalizeCompliance(balance, ledger, evidence, current);
        setSnapshot({
          status: "success",
          error: null,
          summary,
          raw: { balance, ledger, evidence },
        });
      } catch (error: any) {
        setSnapshot({
          status: "error",
          error: error?.message ?? "Failed to load compliance data",
          summary: null,
          raw: {},
        });
      }
    },
    [client],
  );

  useEffect(() => {
    load(selection);
  }, [selection, load]);

  const setSelection = useCallback((update: Partial<ComplianceSelection>) => {
    setSelectionState((prev) => ({ ...prev, ...update }));
  }, []);

  const refresh = useCallback(() => load(selection), [load, selection]);

  const value = useMemo<ComplianceContextValue>(() => ({
    selection,
    setSelection,
    refresh,
    snapshot,
  }), [selection, setSelection, refresh, snapshot]);

  return <ComplianceContext.Provider value={value}>{children}</ComplianceContext.Provider>;
}

export function useCompliance(): ComplianceContextValue {
  const ctx = useContext(ComplianceContext);
  if (!ctx) {
    throw new Error("useCompliance must be used within a ComplianceProvider");
  }
  return ctx;
}
