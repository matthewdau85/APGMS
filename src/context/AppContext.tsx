import React, { createContext, useCallback, useMemo, useState } from "react";
import type { BASHistory } from "../types/tax";
import { mockPayroll, mockSales, mockBasHistory } from "../utils/mockData";
import { configureBankApi } from "../utils/bankApi";
import { configurePayrollApi, fetchPayrollRuns, NormalisedPayrollRun } from "../utils/payrollApi";
import { configurePosApi, fetchPosTransactions, NormalisedSale } from "../utils/posApi";
import { fetchRuntimeConfig, getPublicRuntimeConfig, normaliseBasHistory, type PublicRuntimeConfig } from "../utils/runtimeConfig";

export interface AuditEntry {
  timestamp: number;
  action: string;
  user: string;
  detail?: string;
}

export interface AppContextValue {
  config: PublicRuntimeConfig;
  vaultBalance: number;
  setVaultBalance: React.Dispatch<React.SetStateAction<number>>;
  businessBalance: number;
  setBusinessBalance: React.Dispatch<React.SetStateAction<number>>;
  payroll: NormalisedPayrollRun[];
  setPayroll: React.Dispatch<React.SetStateAction<NormalisedPayrollRun[]>>;
  sales: NormalisedSale[];
  setSales: React.Dispatch<React.SetStateAction<NormalisedSale[]>>;
  basHistory: BASHistory[];
  setBasHistory: React.Dispatch<React.SetStateAction<BASHistory[]>>;
  auditLog: AuditEntry[];
  setAuditLog: React.Dispatch<React.SetStateAction<AuditEntry[]>>;
  loading: boolean;
  lastSyncError: string | null;
  refresh: () => Promise<void>;
}

const defaultThrow = () => {
  throw new Error("AppContext used outside of provider");
};

const DEFAULT_CONFIG = getPublicRuntimeConfig();

export const AppContext = createContext<AppContextValue>({
  config: DEFAULT_CONFIG,
  vaultBalance: 0,
  setVaultBalance: defaultThrow,
  businessBalance: 0,
  setBusinessBalance: defaultThrow,
  payroll: [],
  setPayroll: defaultThrow,
  sales: [],
  setSales: defaultThrow,
  basHistory: [],
  setBasHistory: defaultThrow,
  auditLog: [],
  setAuditLog: defaultThrow,
  loading: true,
  lastSyncError: null,
  refresh: async () => defaultThrow(),
});

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [config, setConfig] = useState<PublicRuntimeConfig>(DEFAULT_CONFIG);
  const [vaultBalance, setVaultBalance] = useState(10000);
  const [businessBalance, setBusinessBalance] = useState(50000);
  const [payroll, setPayroll] = useState<NormalisedPayrollRun[]>([]);
  const [sales, setSales] = useState<NormalisedSale[]>([]);
  const [basHistoryState, setBasHistoryState] = useState<BASHistory[]>(normaliseBasHistory(mockBasHistory));
  const [auditLog, setAuditLog] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastSyncError, setLastSyncError] = useState<string | null>(null);
  const setBasHistory = useCallback(
    (value: React.SetStateAction<BASHistory[]>) => {
      setBasHistoryState((prev) => {
        const next = typeof value === "function" ? (value as (prev: BASHistory[]) => BASHistory[])(prev) : value;
        return normaliseBasHistory(next);
      });
    },
    [],
  );

  const loadData = useCallback(
    async (cfg: PublicRuntimeConfig) => {
      configureBankApi(cfg);
      configurePayrollApi(cfg);
      configurePosApi(cfg);

      if (cfg.flags.useMockData) {
        setPayroll(mockPayroll.map((run, index) => ({
          id: `mock-${index}`,
          employee: run.employee,
          gross: run.gross,
          withheld: run.withheld,
          paidAt: new Date(Date.now() - index * 7 * 24 * 60 * 60 * 1000).toISOString(),
          source: "mock",
        })));
        setSales(mockSales.map((sale, index) => ({
          id: sale.id ?? `mock-sale-${index}`,
          amount: sale.amount,
          exempt: sale.exempt,
          occurredAt: new Date(Date.now() - index * 24 * 60 * 60 * 1000).toISOString(),
          source: "mock",
        })));
        setLastSyncError(null);
        return;
      }

      try {
        const [payrollResult, posResult] = await Promise.all([
          fetchPayrollRuns(),
          fetchPosTransactions(),
        ]);

        setPayroll(payrollResult.runs);
        setSales(posResult.sales);
        setLastSyncError(null);
      } catch (error: any) {
        const message = error?.message ?? "Failed to load integrations";
        if (cfg.flags.fallbackToMockOnError) {
          setPayroll(mockPayroll.map((run, index) => ({
            id: `mock-${index}`,
            employee: run.employee,
            gross: run.gross,
            withheld: run.withheld,
            paidAt: new Date(Date.now() - index * 7 * 24 * 60 * 60 * 1000).toISOString(),
            source: "mock",
          })));
          setSales(mockSales.map((sale, index) => ({
            id: sale.id ?? `mock-sale-${index}`,
            amount: sale.amount,
            exempt: sale.exempt,
            occurredAt: new Date(Date.now() - index * 24 * 60 * 60 * 1000).toISOString(),
            source: "mock",
          })));
        }
        setLastSyncError(message);
      }
    },
    [],
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const cfg = await fetchRuntimeConfig();
      setConfig(cfg);
      await loadData(cfg);
    } finally {
      setLoading(false);
    }
  }, [loadData]);

  React.useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value = useMemo<AppContextValue>(
    () => ({
      config,
      vaultBalance,
      setVaultBalance,
      businessBalance,
      setBusinessBalance,
      payroll,
      setPayroll,
      sales,
      setSales,
      basHistory: basHistoryState,
      setBasHistory,
      auditLog,
      setAuditLog,
      loading,
      lastSyncError,
      refresh,
    }),
    [
      config,
      vaultBalance,
      businessBalance,
      payroll,
      sales,
      basHistoryState,
      auditLog,
      loading,
      lastSyncError,
      refresh,
    ],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
