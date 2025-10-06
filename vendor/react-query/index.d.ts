import * as React from "react";

export type QueryKey = readonly unknown[] | string | number;

export class QueryClient {
  get<T>(key: QueryKey): T | undefined;
  set<T>(key: QueryKey, value: T): void;
}

export interface QueryClientProviderProps {
  client: QueryClient;
  children: React.ReactNode;
}

export function QueryClientProvider(props: QueryClientProviderProps): React.ReactElement | null;

export interface UseQueryOptions<T> {
  queryKey: QueryKey;
  queryFn: () => Promise<T>;
  refetchInterval?: number;
}

export interface UseQueryResult<T> {
  data: T | undefined;
  error: Error | null;
  isError: boolean;
  isLoading: boolean;
  status: "idle" | "loading" | "success" | "error";
}

export function useQuery<T>(options: UseQueryOptions<T>): UseQueryResult<T>;
