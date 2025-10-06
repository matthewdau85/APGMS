import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";

type QueryKey = readonly unknown[];

type QueryState<TData> = {
  data?: TData;
  error?: unknown;
  isFetching: boolean;
};

type UseQueryOptions<TData> = {
  queryKey: QueryKey;
  queryFn: () => Promise<TData>;
  enabled?: boolean;
  retry?: boolean | number;
};

type UseQueryResult<TData> = QueryState<TData> & {
  refetch: () => Promise<void>;
};

class QueryClient {
  private cache = new Map<string, unknown>();

  get<TData>(key: string): TData | undefined {
    return this.cache.get(key) as TData | undefined;
  }

  set<TData>(key: string, value: TData): void {
    this.cache.set(key, value);
  }

  clear(): void {
    this.cache.clear();
  }
}

const QueryClientContext = createContext<QueryClient | null>(null);

function normaliseKey(key: QueryKey): string {
  return JSON.stringify(key);
}

export function QueryClientProvider({ client, children }: { client: QueryClient; children: React.ReactNode }) {
  return <QueryClientContext.Provider value={client}>{children}</QueryClientContext.Provider>;
}

export function useQuery<TData>(options: UseQueryOptions<TData>): UseQueryResult<TData> {
  const client = useContext(QueryClientContext);
  if (!client) {
    throw new Error("QueryClientProvider missing");
  }

  const { queryKey, queryFn, enabled = true } = options;
  const key = useMemo(() => normaliseKey(queryKey), [queryKey]);
  const mounted = useRef(true);
  const initial = client.get<TData>(key);

  const [state, setState] = useState<QueryState<TData>>({ data: initial, isFetching: enabled && !initial });

  const run = useMemo(
    () =>
      async () => {
        if (!enabled) return;
        setState(prev => ({ ...prev, isFetching: true }));
        try {
          const data = await queryFn();
          if (mounted.current) {
            client.set(key, data);
            setState({ data, isFetching: false });
          }
        } catch (error) {
          if (mounted.current) {
            setState(prev => ({ ...prev, error, isFetching: false }));
          }
        }
      },
    [client, queryFn, enabled, key]
  );

  useEffect(() => {
    mounted.current = true;
    if (enabled && !client.get<TData>(key)) {
      void run();
    }
    return () => {
      mounted.current = false;
    };
  }, [client, enabled, key, run]);

  return {
    data: state.data,
    error: state.error,
    isFetching: state.isFetching,
    refetch: run,
  };
}

export { QueryClient };
