declare module "*.svg" {
  const content: string;
  export default content;
}

declare module "@tanstack/react-query" {
  import type React from "react";

  export class QueryClient {}
  export const QueryClientProvider: React.ComponentType<{
    client: QueryClient;
    children?: React.ReactNode;
  }>;

  export interface UseQueryResult<TData = unknown, TError = unknown> {
    data: TData | undefined;
    error: TError | null;
    isError: boolean;
    isLoading: boolean;
    refetch: () => Promise<void>;
  }

  export interface UseQueryOptions<TData = unknown> {
    queryKey: readonly unknown[];
    queryFn: () => Promise<TData>;
    refetchInterval?: number;
  }

  export function useQuery<TData = unknown>(
    options: UseQueryOptions<TData>
  ): UseQueryResult<TData>;
}
