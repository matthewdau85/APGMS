import React, { createContext, useContext, useMemo, useSyncExternalStore, useCallback } from "react";

type QueryStatus = "idle" | "loading" | "success" | "error";

type QueryKey = ReadonlyArray<unknown>;

type QueryState<T = unknown> = {
  status: QueryStatus;
  data?: T;
  error?: unknown;
  updatedAt: number;
  listeners: Set<() => void>;
  promise?: Promise<unknown>;
};

function hashKey(key: QueryKey): string {
  return JSON.stringify(key);
}

export class QueryClient {
  private cache = new Map<string, QueryState>();

  private ensure<T = unknown>(hash: string): QueryState<T> {
    if (!this.cache.has(hash)) {
      this.cache.set(hash, {
        status: "idle",
        updatedAt: 0,
        listeners: new Set(),
      });
    }
    return this.cache.get(hash)! as QueryState<T>;
  }

  getState<T = unknown>(hash: string): QueryState<T> {
    return this.ensure<T>(hash);
  }

  subscribe(hash: string, listener: () => void): () => void {
    const state = this.ensure(hash);
    state.listeners.add(listener);
    return () => {
      state.listeners.delete(listener);
    };
  }

  private notify(hash: string) {
    const state = this.cache.get(hash);
    if (!state) return;
    state.listeners.forEach((listener) => listener());
  }

  async fetch<T>(hash: string, fn: () => Promise<T>, staleTime: number, onError?: (error: unknown) => void, force = false): Promise<T> {
    const state = this.ensure<T>(hash);
    const now = Date.now();

    if (!force) {
      if (state.status === "loading" && state.promise) {
        return state.promise as Promise<T>;
      }
      if (state.status === "success" && staleTime > 0 && now - state.updatedAt < staleTime) {
        return Promise.resolve(state.data as T);
      }
    }

    const promise = fn();
    state.status = "loading";
    state.promise = promise;
    state.error = undefined;
    this.notify(hash);

    try {
      const data = await promise;
      state.status = "success";
      state.data = data;
      state.updatedAt = Date.now();
      state.promise = undefined;
      this.notify(hash);
      return data;
    } catch (err) {
      state.status = "error";
      state.error = err;
      state.updatedAt = Date.now();
      state.promise = undefined;
      this.notify(hash);
      onError?.(err);
      throw err;
    }
  }
}

const QueryClientContext = createContext<QueryClient | null>(null);

export function QueryClientProvider({ client, children }: { client: QueryClient; children: React.ReactNode }) {
  const value = useMemo(() => client, [client]);
  return <QueryClientContext.Provider value={value}>{children}</QueryClientContext.Provider>;
}

export function useQueryClient(): QueryClient {
  const ctx = useContext(QueryClientContext);
  if (!ctx) {
    throw new Error("useQueryClient must be used within QueryClientProvider");
  }
  return ctx;
}

export interface UseQueryOptions<TData> {
  queryKey: QueryKey;
  queryFn: () => Promise<TData>;
  staleTime?: number;
  enabled?: boolean;
  onError?: (error: unknown) => void;
}

export interface UseQueryResult<TData> {
  data: TData | undefined;
  error: unknown;
  isLoading: boolean;
  isFetching: boolean;
  status: QueryStatus;
  dataUpdatedAt: number;
  refetch: () => Promise<TData>;
}

export function useQuery<TData>(options: UseQueryOptions<TData>): UseQueryResult<TData> {
  const { queryKey, queryFn, staleTime = 0, enabled = true, onError } = options;
  const client = useQueryClient();
  const hash = useMemo(() => hashKey(queryKey), [queryKey]);

  const snapshot = useSyncExternalStore(
    useCallback((listener: () => void) => client.subscribe(hash, listener), [client, hash]),
    useCallback(() => client.getState<TData>(hash), [client, hash]),
    useCallback(() => client.getState<TData>(hash), [client, hash])
  );

  const triggerFetch = useCallback(
    (force = false) => client.fetch<TData>(hash, queryFn, staleTime, onError, force),
    [client, hash, queryFn, staleTime, onError]
  );

  React.useEffect(() => {
    if (!enabled) return;
    triggerFetch().catch(() => {
      /* errors handled via state */
    });
  }, [enabled, triggerFetch]);

  const data = snapshot.data as TData | undefined;
  const status = snapshot.status;
  const isLoading = status === "loading" && data === undefined;
  const isFetching = status === "loading";

  const refetch = useCallback(() => triggerFetch(true), [triggerFetch]);

  return {
    data,
    error: snapshot.error,
    isLoading,
    isFetching,
    status,
    dataUpdatedAt: snapshot.updatedAt,
    refetch,
  };
}
