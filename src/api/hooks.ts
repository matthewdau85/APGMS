// src/api/hooks.ts
import { useQuery, UseQueryResult } from "@tanstack/react-query";
import { apiClient } from "./client";
import type { components } from "./types";

type DashboardResponse = components["schemas"]["ConsoleDashboardResponse"];
type BasResponse = components["schemas"]["ConsoleBasResponse"];
type SettingsResponse = components["schemas"]["ConsoleSettingsResponse"];
type AuditResponse = components["schemas"]["ConsoleAuditResponse"];

export const dashboardQueryKey = ["console", "dashboard"] as const;
export const basQueryKey = ["console", "bas"] as const;
export const settingsQueryKey = ["console", "settings"] as const;
export const auditQueryKey = ["console", "audit"] as const;

export function useDashboardQuery(): UseQueryResult<DashboardResponse> {
  return useQuery({
    queryKey: dashboardQueryKey,
    queryFn: () => apiClient.get("/api/console/dashboard"),
    staleTime: 60_000,
  });
}

export function useBasQuery(): UseQueryResult<BasResponse> {
  return useQuery({
    queryKey: basQueryKey,
    queryFn: () => apiClient.get("/api/console/bas"),
    staleTime: 60_000,
  });
}

export function useSettingsQuery(): UseQueryResult<SettingsResponse> {
  return useQuery({
    queryKey: settingsQueryKey,
    queryFn: () => apiClient.get("/api/console/settings"),
    staleTime: 5 * 60_000,
  });
}

export function useAuditQuery(): UseQueryResult<AuditResponse> {
  return useQuery({
    queryKey: auditQueryKey,
    queryFn: () => apiClient.get("/api/console/audit"),
    staleTime: 30_000,
  });
}
