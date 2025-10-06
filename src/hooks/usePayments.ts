import { useEffect, useMemo, useRef } from "react";
import { useQuery, UseQueryOptions } from "@tanstack/react-query";
import { ApiError, ApiSuccess, BalanceQuery, BalanceResponse, getBalance, getLedger, LedgerResponse } from "../api/client";
import { useToast } from "../providers/ToastProvider";

export const DEFAULT_QUERY: BalanceQuery = {
  abn: "12345678901",
  taxType: "GST",
  periodId: "2025-10",
};

interface UseApiQueryOptions<TData> extends Omit<UseQueryOptions<ApiSuccess<TData>, ApiError, ApiSuccess<TData>>, "queryFn"> {
  queryFn: () => Promise<ApiSuccess<TData>>;
  errorMessage?: string;
}

function useApiQuery<TData>({ errorMessage, ...options }: UseApiQueryOptions<TData>) {
  const { pushToast } = useToast();
  const lastRequestId = useRef<string | null | undefined>(null);
  const query = useQuery<ApiSuccess<TData>, ApiError, ApiSuccess<TData>>({
    retry: 1,
    refetchOnWindowFocus: false,
    ...options,
  });

  const error = query.error;
  useEffect(() => {
    if (!error) {
      lastRequestId.current = undefined;
      return;
    }
    const dedupeKey = error.requestId ?? `${error.status}:${error.message}`;
    if (lastRequestId.current === dedupeKey) return;
    lastRequestId.current = dedupeKey;
    const description = error.body && typeof error.body === "object" && error.body !== null
      ? (error.body as any).detail || (error.body as any).error
      : undefined;
    pushToast({
      tone: "error",
      title: errorMessage ?? "Request failed",
      description: description ?? error.message,
      requestId: error.requestId ?? undefined,
    });
  }, [error, errorMessage, pushToast]);

  return query;
}

export function useBalance(query: BalanceQuery = DEFAULT_QUERY) {
  return useApiQuery<BalanceResponse>({
    queryKey: ["balance", query],
    queryFn: () => getBalance(query),
    errorMessage: "Unable to load balance",
    staleTime: 60_000,
  });
}

export function useLedger(query: BalanceQuery = DEFAULT_QUERY) {
  return useApiQuery<LedgerResponse>({
    queryKey: ["ledger", query],
    queryFn: () => getLedger(query),
    errorMessage: "Unable to load ledger",
    staleTime: 60_000,
  });
}

export function useBasSummary(query: BalanceQuery = DEFAULT_QUERY) {
  const balanceQuery = useBalance(query);
  const ledgerQuery = useLedger(query);

  const summary = useMemo(() => {
    const balance = balanceQuery.data?.data;
    const ledger = ledgerQuery.data?.data;
    if (!balance || !ledger) return null;

    const outstandingCents = Math.max(0, balance.balance_cents);
    const hasRelease = balance.has_release;
    const sortedRows = [...ledger.rows].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    const lastRow = sortedRows.at(-1) ?? null;
    const lastBasDate = lastRow ? new Date(lastRow.created_at) : null;

    const complianceScore = (() => {
      let score = 100;
      if (!hasRelease) score -= 25;
      if (outstandingCents > 0) {
        score -= Math.min(50, Math.round(outstandingCents / 2_000));
      }
      const oldestEntry = sortedRows[0];
      if (oldestEntry) {
        const ageDays = (Date.now() - new Date(oldestEntry.created_at).getTime()) / (1000 * 60 * 60 * 24);
        if (ageDays > 30) {
          score -= 15;
        }
      }
      return Math.min(100, Math.max(0, score));
    })();

    const outstandingAmounts = outstandingCents > 0 ? [`$${(outstandingCents / 100).toFixed(2)} owed`] : [];
    const outstandingLodgments = hasRelease ? [] : [balance.periodId];

    const nextDue = (() => {
      const [year, month] = balance.periodId.split("-");
      if (month?.startsWith("Q")) {
        return `Quarter ${month} ${year}`;
      }
      if (!year || !month) return balance.periodId;
      const date = new Date(Number(year), Number(month), 0);
      date.setDate(28);
      return date.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
    })();

    return {
      outstandingCents,
      hasRelease,
      complianceScore,
      lastBasDate,
      nextDue,
      outstandingAmounts,
      outstandingLodgments,
      balance,
      ledger,
    };
  }, [balanceQuery.data, ledgerQuery.data]);

  return {
    summary,
    balanceQuery,
    ledgerQuery,
    isLoading: balanceQuery.isLoading || ledgerQuery.isLoading,
    isFetching: balanceQuery.isFetching || ledgerQuery.isFetching,
  };
}
