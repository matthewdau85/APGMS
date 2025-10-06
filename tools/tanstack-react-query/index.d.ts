import * as React from "react";

export interface UseQueryOptions<TData> {
  queryKey: readonly unknown[];
  queryFn: () => Promise<TData>;
}

export interface UseQueryResult<TData> {
  data: TData | undefined;
  isLoading: boolean;
  error: unknown;
}

export declare class QueryClient {
  constructor();
  getCached<TData = unknown>(key: readonly unknown[]): TData | undefined;
  fetchQuery<TData = unknown>(key: readonly unknown[], fn: () => Promise<TData>): Promise<TData>;
}

export declare function QueryClientProvider(props: {
  client: QueryClient;
  children: React.ReactNode;
}): JSX.Element;

export declare function useQuery<TData = unknown>(options: UseQueryOptions<TData>): UseQueryResult<TData>;
