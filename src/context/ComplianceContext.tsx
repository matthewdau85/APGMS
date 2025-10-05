import React, { createContext, useContext, useMemo } from "react";
import { useQuery, UseQueryResult } from "@tanstack/react-query";

type ComplianceParams = {
  abn: string;
  taxType: string;
  periodId: string;
};

type BalanceResponse = {
  abn: string;
  taxType: string;
  periodId: string;
  balance_cents: number;
  has_release: boolean;
};

type LedgerRow = {
  id: number;
  amount_cents: number;
  balance_after_cents: number;
  rpt_verified: boolean | null;
  release_uuid: string | null;
  bank_receipt_id: string | null;
  created_at: string;
};

type LedgerResponse = {
  abn: string;
  taxType: string;
  periodId: string;
  rows: LedgerRow[];
};

type GateResponse = {
  period_id: string;
  state: string;
  reason_code: string | null;
  updated_at: string | null;
};

type AuditLogEntry = {
  event_time: string;
  category: string;
  message: string;
};

type AuditResponse = {
  period_id: string;
  rpt: string | null;
  audit: AuditLogEntry[];
};

export type ComplianceSummary = {
  params: ComplianceParams;
  balance?: BalanceResponse;
  ledger?: LedgerResponse;
  gate?: GateResponse | null;
  audit?: AuditResponse | null;
  lodgmentsUpToDate: boolean;
  paymentsUpToDate: boolean;
  overallCompliance: number;
  lastBAS: string;
  nextDue: string;
  outstandingLodgments: string[];
  outstandingAmounts: string[];
};

type ComplianceQuery = UseQueryResult<ComplianceSummary, Error> & {
  params: ComplianceParams;
};

const ComplianceContext = createContext<ComplianceQuery | undefined>(undefined);

export const DEFAULT_COMPLIANCE_PARAMS: ComplianceParams = {
  abn: "12345678901",
  taxType: "GST",
  periodId: "2025-Q4",
};

const paymentsBase = (() => {
  const env = typeof import.meta !== "undefined" ? (import.meta as any).env ?? {} : {};
  return env.VITE_PAYMENTS_BASE_URL || process.env.VITE_PAYMENTS_BASE_URL || "/api";
})();

const gateBase = (() => {
  const env = typeof import.meta !== "undefined" ? (import.meta as any).env ?? {} : {};
  return env.VITE_GATE_BASE_URL || process.env.VITE_GATE_BASE_URL || "/api/gate";
})();

const auditBase = (() => {
  const env = typeof import.meta !== "undefined" ? (import.meta as any).env ?? {} : {};
  return env.VITE_AUDIT_BASE_URL || process.env.VITE_AUDIT_BASE_URL || "/api/audit";
})();

async function fetchJson<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const res = await fetch(input, init);
  const text = await res.text();
  let json: any = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch (_err) {
      throw new Error(`Invalid JSON response from ${typeof input === "string" ? input : input.toString()}`);
    }
  }

  if (!res.ok) {
    const message = (json && (json.error || json.detail)) || res.statusText || "Request failed";
    const error = new Error(String(message)) as Error & { status?: number };
    error.status = res.status;
    throw error;
  }

  return json as T;
}

function toCurrency(amountCents: number, currency: string) {
  const formatter = new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  });
  return formatter.format(amountCents / 100);
}

function computeNextDue(periodId: string) {
  const m = /^([0-9]{4})-?Q([1-4])$/.exec(periodId);
  if (!m) return "TBD";
  const year = Number(m[1]);
  const quarter = Number(m[2]);
  const quarterEndMonth = quarter * 3; // 3, 6, 9, 12
  const dueDate = new Date(Date.UTC(year, quarterEndMonth, 28));
  return dueDate.toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" });
}

function parseLastBasDate(audit: AuditResponse | null | undefined) {
  if (!audit || !audit.audit.length) return "Not available";
  for (let i = audit.audit.length - 1; i >= 0; i -= 1) {
    const entry = audit.audit[i];
    if (!entry?.message) continue;
    try {
      const payload = JSON.parse(entry.message);
      if (payload?.ts) {
        const d = new Date(Number(payload.ts) * 1000);
        if (!Number.isNaN(d.getTime())) {
          return d.toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" });
        }
      }
    } catch (_err) {
      // ignore malformed messages and continue searching
    }
  }
  return "Not available";
}

async function fetchCompliance(params: ComplianceParams): Promise<ComplianceSummary> {
  const { abn, taxType, periodId } = params;
  const baseUrl = typeof window !== "undefined" ? window.location.origin : "http://localhost";

  const balanceUrl = new URL(`${paymentsBase.replace(/\/$/, "")}/balance`, baseUrl);
  balanceUrl.searchParams.set("abn", abn);
  balanceUrl.searchParams.set("taxType", taxType);
  balanceUrl.searchParams.set("periodId", periodId);

  const ledgerUrl = new URL(`${paymentsBase.replace(/\/$/, "")}/ledger`, baseUrl);
  ledgerUrl.searchParams.set("abn", abn);
  ledgerUrl.searchParams.set("taxType", taxType);
  ledgerUrl.searchParams.set("periodId", periodId);

  const gateUrl = new URL(`${gateBase.replace(/\/$/, "")}/transition`, baseUrl);
  gateUrl.searchParams.set("period_id", periodId);

  const auditUrl = new URL(`${auditBase.replace(/\/$/, "")}/bundle/${encodeURIComponent(periodId)}`, baseUrl);

  const [balance, ledger, gate, audit] = await Promise.all([
    fetchJson<BalanceResponse>(balanceUrl),
    fetchJson<LedgerResponse>(ledgerUrl),
    fetchJson<GateResponse>(gateUrl).catch((err: Error & { status?: number }) => {
      if (err?.status === 404) {
        return null;
      }
      throw err;
    }),
    fetchJson<AuditResponse>(auditUrl).catch((err: Error & { status?: number }) => {
      if (err?.status === 404) {
        return { period_id: periodId, rpt: null, audit: [] } as AuditResponse;
      }
      throw err;
    }),
  ]);

  const outstandingLodgments = gate
    ? (!["RPT-Issued", "Remitted"].includes(gate.state) ? [periodId] : [])
    : [periodId];

  const outstandingAmounts = balance.balance_cents > 0
    ? [`${toCurrency(balance.balance_cents, "AUD")} ${taxType}`]
    : [];

  const lodgmentsUpToDate = outstandingLodgments.length === 0;
  const paymentsUpToDate = outstandingAmounts.length === 0 && balance.has_release;

  let overallCompliance = 100;
  if (!lodgmentsUpToDate) overallCompliance -= 35;
  if (!paymentsUpToDate) overallCompliance -= 35;
  if (!ledger.rows.length) overallCompliance -= 10;
  if (!audit.audit.length) overallCompliance -= 10;
  if (!balance.has_release) overallCompliance -= 10;
  overallCompliance = Math.max(0, Math.min(100, overallCompliance));

  return {
    params,
    balance,
    ledger,
    gate,
    audit,
    lodgmentsUpToDate,
    paymentsUpToDate,
    overallCompliance,
    lastBAS: parseLastBasDate(audit),
    nextDue: computeNextDue(periodId),
    outstandingLodgments,
    outstandingAmounts,
  };
}

function useComplianceQuery(params: ComplianceParams) {
  return useQuery<ComplianceSummary, Error>({
    queryKey: ["compliance", params],
    queryFn: () => fetchCompliance(params),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

export function ComplianceProvider({
  children,
  params,
}: {
  children: React.ReactNode;
  params?: Partial<ComplianceParams>;
}) {
  const merged = useMemo(() => ({ ...DEFAULT_COMPLIANCE_PARAMS, ...params }), [params]);
  const query = useComplianceQuery(merged);
  const value = useMemo<ComplianceQuery>(() => ({ ...query, params: merged }), [query, merged]);
  return <ComplianceContext.Provider value={value}>{children}</ComplianceContext.Provider>;
}

export function useCompliance(): ComplianceQuery {
  const ctx = useContext(ComplianceContext);
  if (!ctx) {
    throw new Error("useCompliance must be used within a ComplianceProvider");
  }
  return ctx;
}

export { fetchCompliance };
