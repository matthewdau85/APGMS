import { getData } from "../api/client";
import { DEFAULT_ABN, DEFAULT_TAX_TYPE, DEFAULT_PERIOD_ID } from "../config";
import { useApiQuery } from "./useApiQuery";
import { Schemas } from "../api/client";

export function useBasPreview() {
  return useApiQuery(["bas-preview"], () => getData("/bas/preview"), {
    errorMessage: "Failed to load BAS preview",
    staleTime: 60_000,
  });
}

export function useDashboardSummary() {
  return useApiQuery(["dashboard", "yesterday"], () => getData("/dashboard/yesterday"), {
    errorMessage: "Failed to load dashboard metrics",
    staleTime: 60_000,
  });
}

export function useBalance() {
  return useApiQuery(
    ["balance", DEFAULT_ABN, DEFAULT_TAX_TYPE, DEFAULT_PERIOD_ID],
    () =>
      getData("/api/balance", {
        params: {
          query: { abn: DEFAULT_ABN, taxType: DEFAULT_TAX_TYPE, periodId: DEFAULT_PERIOD_ID },
        },
      }),
    {
      errorMessage: "Failed to load vault balance",
      staleTime: 30_000,
    }
  );
}

export function useSettings() {
  return useApiQuery(["settings"], () => getData("/settings"), {
    errorMessage: "Failed to load settings",
    staleTime: 60_000,
  });
}

export function useBusinessProfile() {
  return useApiQuery(["profile"], () => getData("/profile"), {
    errorMessage: "Failed to load business profile",
    staleTime: 60_000,
  });
}

export function useConnections() {
  return useApiQuery(["connections"], () => getData("/connections"), {
    errorMessage: "Failed to load connections",
    staleTime: 30_000,
  });
}

export function useTransactions() {
  return useApiQuery(["transactions"], () => getData("/transactions"), {
    errorMessage: "Failed to load transactions",
    staleTime: 30_000,
  });
}

export function useEvidence() {
  return useApiQuery(
    ["evidence", DEFAULT_ABN, DEFAULT_TAX_TYPE, DEFAULT_PERIOD_ID],
    () =>
      getData("/api/evidence", {
        params: {
          query: { abn: DEFAULT_ABN, taxType: DEFAULT_TAX_TYPE, periodId: DEFAULT_PERIOD_ID },
        },
      }),
    {
      errorMessage: "Failed to load audit evidence",
      staleTime: 120_000,
    }
  );
}

export type BasPreview = Schemas["BasPreview"];
export type DashboardSummary = Schemas["DashboardYesterday"];
export type BalanceResponse = Schemas["BalanceResponse"];
export type SettingsResponse = Schemas["Settings"];
export type BusinessProfile = Schemas["BusinessProfile"];
export type ConnectionsResponse = Schemas["Connection"][];
export type TransactionsResponse = Schemas["TransactionsResponse"];
export type EvidenceBundle = Schemas["EvidenceBundle"];
