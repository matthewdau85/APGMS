import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import type { components, paths } from "./schema";

const DEFAULT_PORTAL_URL = "http://localhost:8000";
const API_BASE_URL =
  (typeof process !== "undefined" && process.env.REACT_APP_PORTAL_API_URL) ||
  (typeof window !== "undefined" && (window as any).__PORTAL_API_URL__) ||
  DEFAULT_PORTAL_URL;

type PathResponse<P extends keyof paths, M extends keyof paths[P]> =
  paths[P][M] extends { responses: { 200: { content: { "application/json": infer R } } } }
    ? R
    : never;

async function getJson<T>(path: string): Promise<T> {
  const url = `${API_BASE_URL}${path}`;
  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
    },
    credentials: "include",
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Request failed (${res.status}): ${body || res.statusText}`);
  }
  return res.json() as Promise<T>;
}

export type DashboardYesterday = components["schemas"]["DashboardYesterday"];
export type BasPreview = components["schemas"]["BasPreview"];
export type AtoStatus = components["schemas"]["AtoStatus"];

export const queryKeys = {
  dashboardYesterday: ["dashboard", "yesterday"] as const,
  basPreview: ["bas", "preview"] as const,
  atoStatus: ["ato", "status"] as const,
};

export function fetchDashboardYesterday() {
  return getJson<PathResponse<"/dashboard/yesterday", "get">>("/dashboard/yesterday");
}

export function fetchBasPreview() {
  return getJson<PathResponse<"/bas/preview", "get">>("/bas/preview");
}

export function fetchAtoStatus() {
  return getJson<PathResponse<"/ato/status", "get">>("/ato/status");
}

type QueryOptions<TData> = Omit<UseQueryOptions<TData, Error, TData, readonly unknown[]>, "queryKey" | "queryFn">;

export function useDashboardYesterday(options?: QueryOptions<DashboardYesterday>) {
  return useQuery({
    queryKey: queryKeys.dashboardYesterday,
    queryFn: fetchDashboardYesterday,
    staleTime: 60_000,
    ...options,
  });
}

export function useBasPreview(options?: QueryOptions<BasPreview>) {
  return useQuery({
    queryKey: queryKeys.basPreview,
    queryFn: fetchBasPreview,
    staleTime: 5 * 60_000,
    ...options,
  });
}

export function useAtoStatus(options?: QueryOptions<AtoStatus>) {
  return useQuery({
    queryKey: queryKeys.atoStatus,
    queryFn: fetchAtoStatus,
    staleTime: 5 * 60_000,
    ...options,
  });
}
