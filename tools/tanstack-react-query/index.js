const React = require("react");

function serializeKey(key) {
  try {
    return JSON.stringify(key);
  } catch {
    return String(key);
  }
}

class QueryClient {
  constructor() {
    this._cache = new Map();
    this._promises = new Map();
  }

  getCached(key) {
    const id = serializeKey(key);
    const entry = this._cache.get(id);
    return entry ? entry.data : undefined;
  }

  async fetchQuery(key, fn) {
    const id = serializeKey(key);
    if (this._cache.has(id)) {
      return this._cache.get(id).data;
    }
    if (this._promises.has(id)) {
      return this._promises.get(id);
    }
    const promise = Promise.resolve()
      .then(fn)
      .then((data) => {
        this._cache.set(id, { data });
        this._promises.delete(id);
        return data;
      })
      .catch((err) => {
        this._promises.delete(id);
        throw err;
      });
    this._promises.set(id, promise);
    return promise;
  }
}

const QueryClientContext = React.createContext(null);

function QueryClientProvider({ client, children }) {
  if (!client) {
    throw new Error("QueryClientProvider requires a client instance");
  }
  return React.createElement(QueryClientContext.Provider, { value: client }, children);
}

function useQuery(options) {
  if (!options || !options.queryKey || !options.queryFn) {
    throw new Error("useQuery requires queryKey and queryFn options");
  }
  const client = React.useContext(QueryClientContext);
  if (!client) {
    throw new Error("No QueryClient set, use QueryClientProvider to set one");
  }
  const { queryKey, queryFn } = options;
  const id = serializeKey(queryKey);
  const [state, setState] = React.useState(() => {
    const cached = client.getCached(queryKey);
    return {
      data: cached,
      isLoading: !cached,
      error: null,
    };
  });

  React.useEffect(() => {
    let active = true;
    setState((prev) => ({ ...prev, isLoading: true }));
    client
      .fetchQuery(queryKey, queryFn)
      .then((data) => {
        if (!active) return;
        setState({ data, isLoading: false, error: null });
      })
      .catch((err) => {
        if (!active) return;
        setState({ data: undefined, isLoading: false, error: err });
      });
    return () => {
      active = false;
    };
  }, [client, id, queryFn]);

  return {
    data: state.data,
    isLoading: state.isLoading,
    error: state.error,
  };
}

module.exports = {
  QueryClient,
  QueryClientProvider,
  useQuery,
};
