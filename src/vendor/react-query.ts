// src/vendor/react-query.ts
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

export type QueryKey = ReadonlyArray<unknown>;

type QueryStatus = "idle" | "loading" | "success" | "error";

interface QueryState<T> {
  status: QueryStatus;
  data?: T;
  error?: unknown;
  updatedAt?: number;
}

function keyToKeyString(key: QueryKey): string {
  return JSON.stringify(key ?? []);
}

export class QueryClient {
  private cache = new Map<string, QueryState<any>>();
  private listeners = new Map<string, Set<() => void>>();

  private ensureListeners(key: string): Set<() => void> {
    let set = this.listeners.get(key);
    if (!set) {
      set = new Set();
      this.listeners.set(key, set);
    }
    return set;
  }

  getQueryState<T>(key: QueryKey): QueryState<T> | undefined {
    return this.cache.get(keyToKeyString(key));
  }

  setQueryState<T>(key: QueryKey, state: QueryState<T>): void {
    const k = keyToKeyString(key);
    this.cache.set(k, state);
    const listeners = this.listeners.get(k);
    if (listeners) {
      for (const listener of listeners) {
        listener();
      }
    }
  }

  subscribe(key: QueryKey, listener: () => void): () => void {
    const k = keyToKeyString(key);
    const listeners = this.ensureListeners(k);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
      if (!listeners.size) {
        this.listeners.delete(k);
      }
    };
  }
}

const QueryClientContext = createContext<QueryClient | null>(null);

export function QueryClientProvider({
  client,
  children,
}: {
  client: QueryClient;
  children?: React.ReactNode;
}) {
  return (
    <QueryClientContext.Provider value={client}>
      {children}
    </QueryClientContext.Provider>
  );
}

export function useQueryClient(): QueryClient {
  const client = useContext(QueryClientContext);
  if (!client) {
    throw new Error("useQueryClient must be used within a QueryClientProvider");
  }
  return client;
}

export interface UseQueryOptions<TData> {
  queryKey: QueryKey;
  queryFn: () => Promise<TData>;
  staleTime?: number;
  enabled?: boolean;
}

export interface UseQueryResult<TData, TError = unknown> {
  data: TData | undefined;
  error: TError | null;
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  refetch: () => Promise<void>;
}

export function useQuery<TData, TError = unknown>(
  options: UseQueryOptions<TData>
): UseQueryResult<TData, TError> {
  const { queryKey, queryFn, staleTime = 0, enabled = true } = options;
  const client = useQueryClient();
  const keyString = useMemo(() => keyToKeyString(queryKey), [queryKey]);
  const keyRef = useRef<QueryKey>(queryKey);
  keyRef.current = queryKey;

  const [state, setState] = useState<QueryState<TData>>(() => {
    return client.getQueryState<TData>(queryKey) ?? { status: "idle" };
  });

  useEffect(() => {
    return client.subscribe(queryKey, () => {
      const next = client.getQueryState<TData>(queryKey);
      if (next) setState(next);
    });
  }, [client, keyString, queryKey]);

  useEffect(() => {
    if (!enabled) return;
    const current = client.getQueryState<TData>(queryKey);
    const now = Date.now();
    const isStale =
      !current ||
      current.status === "idle" ||
      current.status === "error" ||
      (staleTime > 0 && (!current.updatedAt || now - current.updatedAt > staleTime));
    if (!isStale) {
      setState(current);
      return;
    }

    let cancelled = false;
    client.setQueryState<TData>(queryKey, {
      status: "loading",
      data: current?.data,
      error: undefined,
      updatedAt: current?.updatedAt,
    });

    queryFn()
      .then((data) => {
        if (cancelled) return;
        client.setQueryState<TData>(queryKey, {
          status: "success",
          data,
          error: undefined,
          updatedAt: Date.now(),
        });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        client.setQueryState<TData>(queryKey, {
          status: "error",
          data: current?.data,
          error,
          updatedAt: Date.now(),
        });
      });

    return () => {
      cancelled = true;
    };
  }, [client, keyString, queryFn, queryKey, staleTime, enabled]);

  const refetch = useCallback(async () => {
    const current = client.getQueryState<TData>(keyRef.current);
    client.setQueryState<TData>(keyRef.current, {
      status: "loading",
      data: current?.data,
      error: undefined,
      updatedAt: Date.now(),
    });
    try {
      const data = await queryFn();
      client.setQueryState<TData>(keyRef.current, {
        status: "success",
        data,
        error: undefined,
        updatedAt: Date.now(),
      });
    } catch (error) {
      client.setQueryState<TData>(keyRef.current, {
        status: "error",
        data: current?.data,
        error,
        updatedAt: Date.now(),
      });
      throw error;
    }
  }, [client, queryFn]);

  const resultState = state ?? { status: "idle" as QueryStatus };
  return {
    data: resultState.data,
    error: (resultState.error ?? null) as TError | null,
    isLoading: resultState.status === "loading" && resultState.data === undefined,
    isFetching: resultState.status === "loading",
    isError: resultState.status === "error",
    refetch,
  };
}
