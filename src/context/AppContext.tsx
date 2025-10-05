import React, { createContext, useContext, useMemo } from "react";
import {
  DEFAULT_PERIOD,
  PeriodQuery,
  BalanceResponse,
  LedgerRow,
  EvidenceResponse,
  LedgerTotals,
  ComplianceSummary,
  usePeriodData,
  buildComplianceSummary,
  centsToDollars,
} from "../hooks/usePeriodData";

export type AppContextValue = {
  query: PeriodQuery;
  balance: BalanceResponse | null;
  ledger: LedgerRow[];
  evidence: EvidenceResponse | null;
  totals: LedgerTotals;
  summary: ComplianceSummary;
  vaultBalanceCents: number | null;
  vaultBalance: number | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => void;
};

const defaultValue: AppContextValue = {
  query: DEFAULT_PERIOD,
  balance: null,
  ledger: [],
  evidence: null,
  totals: { totalDepositsCents: 0, totalReleasesCents: 0 },
  summary: {
    lodgmentsUpToDate: false,
    paymentsUpToDate: false,
    overallCompliance: 0,
    outstandingLodgments: [],
    outstandingAmounts: [],
    alerts: [],
  },
  vaultBalanceCents: null,
  vaultBalance: null,
  isLoading: false,
  error: null,
  refresh: () => undefined,
};

export const AppContext = createContext<AppContextValue>(defaultValue);

export function AppProvider({ children, params }: { children: React.ReactNode; params?: PeriodQuery }) {
  const query = params ?? DEFAULT_PERIOD;
  const { balance, ledger, evidence, totals, error, isLoading, refresh } = usePeriodData(query);

  const summary = useMemo(
    () => buildComplianceSummary(query, balance, ledger, evidence),
    [query, balance, ledger, evidence]
  );

  const vaultBalanceCents = balance?.balance_cents ?? null;
  const value = useMemo<AppContextValue>(
    () => ({
      query,
      balance,
      ledger,
      evidence,
      totals,
      summary,
      vaultBalanceCents,
      vaultBalance: centsToDollars(vaultBalanceCents),
      isLoading,
      error,
      refresh,
    }),
    [query, balance, ledger, evidence, totals, summary, vaultBalanceCents, isLoading, error, refresh]
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useAppContext() {
  return useContext(AppContext);
}
