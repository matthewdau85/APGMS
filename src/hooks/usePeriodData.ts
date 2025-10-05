import { useMemo } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { createPaymentsClient } from "../../libs/paymentsClient";
import type {
  BalanceResponse,
  ComplianceSnapshot,
  EvidenceResponse,
  LedgerResponse,
  PeriodQuery,
} from "../types/payments";

const DEFAULT_PERIOD: PeriodQuery = {
  abn: "12345678901",
  taxType: "GST",
  periodId: "2025-10",
};

const paymentsApi = createPaymentsClient({
  baseUrl: "/api",
  routes: { payAto: "/release" },
});

function centsToDollars(cents: number) {
  return cents / 100;
}

function formatCurrency(cents: number) {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    minimumFractionDigits: 2,
  }).format(centsToDollars(cents));
}

function deriveNextDue(periodId: string) {
  const [yearStr, monthStr] = periodId.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr) - 1; // Date months are 0-indexed
  if (!Number.isFinite(year) || !Number.isFinite(month)) return "TBA";
  const next = new Date(Date.UTC(year, month + 1, 1));
  next.setUTCDate(0); // last day of previous month (end of next period)
  return next.toLocaleDateString("en-AU", { timeZone: "UTC" });
}

function deriveCompliance(
  params: PeriodQuery,
  balance?: BalanceResponse,
  evidence?: EvidenceResponse
): ComplianceSnapshot {
  const outstandingCents = Math.max(balance?.balance_cents ?? 0, 0);
  const lodgmentsUpToDate = Boolean(evidence?.rpt);
  const paymentsUpToDate = outstandingCents === 0 || Boolean(balance?.has_release);
  const numerator = Number(lodgmentsUpToDate) + Number(paymentsUpToDate);
  const overallCompliance = Math.round((numerator / 2) * 100);

  const lastBasTs = evidence?.rpt?.created_at || evidence?.meta.generated_at;
  const lastBAS = lastBasTs
    ? new Date(lastBasTs).toLocaleString("en-AU", { timeZone: "UTC" })
    : "Pending";

  const nextDue = deriveNextDue(params.periodId);
  const outstandingLodgments = lodgmentsUpToDate ? [] : [params.periodId];
  const outstandingAmounts = paymentsUpToDate || outstandingCents === 0
    ? []
    : [`${formatCurrency(outstandingCents)} ${params.taxType}`];

  return {
    lodgmentsUpToDate,
    paymentsUpToDate,
    overallCompliance,
    lastBAS,
    nextDue,
    outstandingLodgments,
    outstandingAmounts,
  };
}

export function usePeriodData(params: PeriodQuery = DEFAULT_PERIOD) {
  const queryClient = useQueryClient();

  const balanceQuery = useQuery<BalanceResponse, Error>({
    queryKey: ["period", params, "balance"],
    queryFn: () => paymentsApi.balance(params),
    refetchInterval: 5000,
  });

  const ledgerQuery = useQuery<LedgerResponse, Error>({
    queryKey: ["period", params, "ledger"],
    queryFn: () => paymentsApi.ledger(params),
    refetchInterval: 5000,
  });

  const evidenceQuery = useQuery<EvidenceResponse, Error>({
    queryKey: ["period", params, "evidence"],
    queryFn: () => paymentsApi.evidence(params),
    refetchInterval: 10000,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["period", params] });
  };

  const runPayrollDay = useMutation({
    mutationFn: (amountCents?: number) =>
      paymentsApi.deposit({ ...params, amountCents: amountCents ?? 250_00 }),
    onSuccess: invalidate,
  });

  const releaseToAto = useMutation({
    mutationFn: (amountCents?: number) =>
      paymentsApi.payAto({ ...params, amountCents: amountCents ?? -250_00 }),
    onSuccess: invalidate,
  });

  const compliance = useMemo(
    () =>
      deriveCompliance(params, balanceQuery.data, evidenceQuery.data),
    [params, balanceQuery.data, evidenceQuery.data]
  );

  const isLoading =
    balanceQuery.isLoading || ledgerQuery.isLoading || evidenceQuery.isLoading;
  const isFetching =
    balanceQuery.isFetching || ledgerQuery.isFetching || evidenceQuery.isFetching;
  const error = balanceQuery.error || ledgerQuery.error || evidenceQuery.error || null;

  return {
    params,
    balanceQuery,
    ledgerQuery,
    evidenceQuery,
    compliance,
    runPayrollDay,
    releaseToAto,
    isLoading,
    isFetching,
    isError: Boolean(error),
    error,
    formatCurrency,
  };
}

export { DEFAULT_PERIOD };
