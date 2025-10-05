import React, {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  ApiState,
  AppQuery,
  BalanceResponse,
  EvidenceBundle,
  SettlementIngestResponse,
} from "../types/api";
import type { BASHistory } from "../types/tax";
import { parsePeriodId } from "../utils/period";

const DEFAULT_QUERY: AppQuery = {
  abn: "12345678901",
  taxType: "GST",
  periodId: "2025Q2",
};

type InitialState = {
  query?: AppQuery;
  balance?: BalanceResponse;
  evidence?: EvidenceBundle;
  basHistory?: BASHistory[];
  auditLog?: any[];
};

type AppContextValue = {
  query: AppQuery;
  updateQuery: (next: Partial<AppQuery>) => Promise<void>;
  balance: BalanceResponse | null;
  balanceLoading: boolean;
  balanceError: string | null;
  refreshBalance: (overrides?: Partial<AppQuery>) => Promise<void>;
  evidence: EvidenceBundle | null;
  evidenceLoading: boolean;
  evidenceError: string | null;
  refreshEvidence: (overrides?: Partial<AppQuery>) => Promise<void>;
  settlementResult: SettlementIngestResponse | null;
  settlementLoading: boolean;
  settlementError: string | null;
  ingestSettlement: (csv: string) => Promise<void>;
  basHistory: BASHistory[];
  setBasHistory: React.Dispatch<React.SetStateAction<BASHistory[]>>;
  auditLog: any[];
  setAuditLog: React.Dispatch<React.SetStateAction<any[]>>;
};

export const AppContext = createContext<AppContextValue>({} as AppContextValue);

type AppProviderProps = {
  children: React.ReactNode;
  fetcher?: typeof fetch;
  initialState?: InitialState;
};

type RefFlags = {
  skipInitial: boolean;
  skipNext: boolean;
};

function buildBasHistoryEntry(
  evidence: EvidenceBundle,
  query: AppQuery,
): BASHistory | null {
  const periodId = evidence.rpt_payload?.period_id || query.periodId;
  if (!periodId) return null;
  const liabilityCents = evidence.rpt_payload?.amount_cents ?? 0;
  const ledger = evidence.owa_ledger_deltas ?? [];
  const hasRelease = ledger.some((delta) => Number(delta.amount_cents) < 0);
  const penalties = evidence.discrepancy_log?.length
    ? evidence.discrepancy_log.length * 50
    : 0;

  return {
    period: parsePeriodId(periodId),
    paygwPaid: 0,
    gstPaid: Number(liabilityCents) / 100,
    status: hasRelease ? "On Time" : "Late",
    daysLate: hasRelease ? 0 : 3,
    penalties,
  };
}

export function AppProvider({ children, fetcher, initialState }: AppProviderProps) {
  const fetchFn = useMemo(() => {
    if (fetcher) return fetcher;
    if (typeof window !== "undefined" && window.fetch) {
      return window.fetch.bind(window);
    }
    return fetch;
  }, [fetcher]);

  const request = useCallback(
    async <T,>(path: string, init?: RequestInit) => {
      const res = await fetchFn(path, init);
      const text = await res.text();
      let payload: any = null;
      if (text) {
        try {
          payload = JSON.parse(text);
        } catch {
          payload = text;
        }
      }
      if (!res.ok) {
        const message =
          (payload && (payload.error || payload.detail)) ||
          (typeof payload === "string" ? payload : null) ||
          res.statusText ||
          "Request failed";
        throw new Error(String(message));
      }
      return (payload as T) ?? (null as T);
    },
    [fetchFn],
  );

  const [query, setQuery] = useState<AppQuery>(initialState?.query || DEFAULT_QUERY);

  const [balanceState, setBalanceState] = useState<ApiState<BalanceResponse>>({
    data: initialState?.balance ?? null,
    loading: !initialState?.balance,
    error: null,
  });

  const [evidenceState, setEvidenceState] = useState<ApiState<EvidenceBundle>>({
    data: initialState?.evidence ?? null,
    loading: !initialState?.evidence,
    error: null,
  });

  const [settlementState, setSettlementState] = useState<ApiState<SettlementIngestResponse>>({
    data: null,
    loading: false,
    error: null,
  });

  const [basHistory, setBasHistory] = useState<BASHistory[]>(
    initialState?.basHistory ?? [],
  );
  const [auditLog, setAuditLog] = useState<any[]>(initialState?.auditLog ?? []);

  const balanceFetchFlags = useRef<RefFlags>({
    skipInitial: Boolean(initialState?.balance),
    skipNext: false,
  });
  const evidenceFetchFlags = useRef<RefFlags>({
    skipInitial: Boolean(initialState?.evidence),
    skipNext: false,
  });

  const fetchBalance = useCallback(
    async (effectiveQuery: AppQuery) => {
      setBalanceState((prev) => ({ ...prev, loading: true, error: null }));
      try {
        const params = new URLSearchParams(effectiveQuery as Record<string, string>);
        const data = await request<BalanceResponse>(
          `/api/payments/balance?${params.toString()}`,
        );
        setBalanceState({ data, loading: false, error: null });
      } catch (err: any) {
        setBalanceState((prev) => ({
          ...prev,
          loading: false,
          error: err?.message || "Failed to load balance",
        }));
      }
    },
    [request],
  );

  const fetchEvidence = useCallback(
    async (effectiveQuery: AppQuery) => {
      setEvidenceState((prev) => ({ ...prev, loading: true, error: null }));
      try {
        const params = new URLSearchParams(effectiveQuery as Record<string, string>);
        const data = await request<EvidenceBundle>(
          `/api/evidence?${params.toString()}`,
        );
        setEvidenceState({ data, loading: false, error: null });
      } catch (err: any) {
        setEvidenceState((prev) => ({
          ...prev,
          loading: false,
          error: err?.message || "Failed to load evidence",
        }));
      }
    },
    [request],
  );

  const refreshBalance = useCallback(
    async (overrides?: Partial<AppQuery>) => {
      if (overrides) {
        const merged = { ...query, ...overrides } as AppQuery;
        balanceFetchFlags.current.skipNext = true;
        setQuery(merged);
        await fetchBalance(merged);
        return;
      }
      await fetchBalance(query);
    },
    [fetchBalance, query],
  );

  const refreshEvidence = useCallback(
    async (overrides?: Partial<AppQuery>) => {
      if (overrides) {
        const merged = { ...query, ...overrides } as AppQuery;
        evidenceFetchFlags.current.skipNext = true;
        setQuery(merged);
        await fetchEvidence(merged);
        return;
      }
      await fetchEvidence(query);
    },
    [fetchEvidence, query],
  );

  const updateQuery = useCallback(
    async (next: Partial<AppQuery>) => {
      const merged = { ...query, ...next } as AppQuery;
      balanceFetchFlags.current.skipNext = true;
      evidenceFetchFlags.current.skipNext = true;
      setQuery(merged);
      await Promise.all([fetchBalance(merged), fetchEvidence(merged)]);
    },
    [fetchBalance, fetchEvidence, query],
  );

  useEffect(() => {
    if (balanceFetchFlags.current.skipInitial) {
      balanceFetchFlags.current.skipInitial = false;
      return;
    }
    if (balanceFetchFlags.current.skipNext) {
      balanceFetchFlags.current.skipNext = false;
      return;
    }
    fetchBalance(query);
  }, [fetchBalance, query]);

  useEffect(() => {
    if (evidenceFetchFlags.current.skipInitial) {
      evidenceFetchFlags.current.skipInitial = false;
      return;
    }
    if (evidenceFetchFlags.current.skipNext) {
      evidenceFetchFlags.current.skipNext = false;
      return;
    }
    fetchEvidence(query);
  }, [fetchEvidence, query]);

  useEffect(() => {
    if (!evidenceState.data) return;
    const entry = buildBasHistoryEntry(evidenceState.data, query);
    if (!entry) return;
    setBasHistory((prev) => {
      const existing = prev.filter(
        (item) => item.period.getTime() !== entry.period.getTime(),
      );
      return [entry, ...existing];
    });
  }, [evidenceState.data, query]);

  const ingestSettlement = useCallback(
    async (csv: string) => {
      setSettlementState({ data: null, loading: true, error: null });
      try {
        const data = await request<SettlementIngestResponse>("/api/settlement/webhook", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ csv }),
        });
        setSettlementState({ data, loading: false, error: null });
      } catch (err: any) {
        setSettlementState({
          data: null,
          loading: false,
          error: err?.message || "Failed to ingest settlement",
        });
      }
    },
    [request],
  );

  const value = useMemo<AppContextValue>(
    () => ({
      query,
      updateQuery,
      balance: balanceState.data,
      balanceLoading: balanceState.loading,
      balanceError: balanceState.error,
      refreshBalance,
      evidence: evidenceState.data,
      evidenceLoading: evidenceState.loading,
      evidenceError: evidenceState.error,
      refreshEvidence,
      settlementResult: settlementState.data,
      settlementLoading: settlementState.loading,
      settlementError: settlementState.error,
      ingestSettlement,
      basHistory,
      setBasHistory,
      auditLog,
      setAuditLog,
    }),
    [
      auditLog,
      balanceState.data,
      balanceState.error,
      balanceState.loading,
      basHistory,
      evidenceState.data,
      evidenceState.error,
      evidenceState.loading,
      ingestSettlement,
      query,
      refreshBalance,
      refreshEvidence,
      settlementState.data,
      settlementState.error,
      settlementState.loading,
      updateQuery,
    ],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
