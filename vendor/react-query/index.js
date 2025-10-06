const React = require("react");

function keyToString(key) {
  if (Array.isArray(key)) return JSON.stringify(key);
  return String(key);
}

class QueryClient {
  constructor() {
    this.cache = new Map();
  }

  get(key) {
    return this.cache.get(keyToString(key));
  }

  set(key, value) {
    this.cache.set(keyToString(key), value);
  }
}

const QueryClientContext = React.createContext(null);

function QueryClientProvider({ client, children }) {
  return React.createElement(QueryClientContext.Provider, { value: client }, children);
}

function useQuery(options) {
  const client = React.useContext(QueryClientContext);
  if (!client) {
    throw new Error("useQuery must be used within a QueryClientProvider");
  }
  const cacheKey = React.useMemo(() => keyToString(options.queryKey), [options.queryKey]);
  const initial = client.get(cacheKey);
  const [data, setData] = React.useState(initial);
  const [error, setError] = React.useState(null);
  const [status, setStatus] = React.useState(initial ? "success" : "idle");

  React.useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setStatus((prev) => (prev === "success" && data ? prev : "loading"));
      try {
        const value = await options.queryFn();
        if (cancelled) return;
        client.set(cacheKey, value);
        setData(value);
        setError(null);
        setStatus("success");
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err : new Error(String(err)));
        setStatus("error");
      }
    };
    run();

    if (options.refetchInterval) {
      const id = setInterval(run, options.refetchInterval);
      return () => {
        cancelled = true;
        clearInterval(id);
      };
    }
    return () => {
      cancelled = true;
    };
  }, [cacheKey, client, options.queryFn, options.refetchInterval, data]);

  return {
    data,
    error,
    isError: status === "error",
    isLoading: status === "loading" && !data,
    status,
  };
}

module.exports = {
  QueryClient,
  QueryClientProvider,
  useQuery,
};
