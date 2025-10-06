import React from "react";
import { RequestTrace, subscribeToRequestTrace } from "../tracing/trace-emitter";

interface RequestTraceContextValue {
  lastTrace: RequestTrace | null;
}

const RequestTraceContext = React.createContext<RequestTraceContextValue | undefined>(undefined);

export function RequestTraceProvider({ children }: { children: React.ReactNode }) {
  const [lastTrace, setLastTrace] = React.useState<RequestTrace | null>(null);

  React.useEffect(() => {
    const unsubscribe = subscribeToRequestTrace((trace) => {
      setLastTrace(trace);
    });
    return unsubscribe;
  }, []);

  const value = React.useMemo(() => ({ lastTrace }), [lastTrace]);

  return <RequestTraceContext.Provider value={value}>{children}</RequestTraceContext.Provider>;
}

export function useRequestTrace() {
  const context = React.useContext(RequestTraceContext);
  if (!context) {
    throw new Error("useRequestTrace must be used within a RequestTraceProvider");
  }
  return context;
}
