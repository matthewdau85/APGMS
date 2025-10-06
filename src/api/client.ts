import type { paths } from "./types";

export async function api<P extends string, T = unknown>(
  path: P,
  init?: RequestInit
): Promise<T> {
  const response = await fetch(path, init);
  if (!response.ok) {
    throw new Error(`${response.status}`);
  }
  return response.json() as Promise<T>;
}

export type PeriodResponse = paths["/api/v1/periods/{periodId}"]["get"]["responses"]["200"]["content"]["application/json"];
export type PeriodListResponse = paths["/api/v1/periods"]["get"]["responses"]["200"]["content"]["application/json"];
