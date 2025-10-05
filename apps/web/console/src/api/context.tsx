import React, { createContext, useContext } from "react";
import type { ConsoleApi } from "./client";

const ApiContext = createContext<ConsoleApi | null>(null);

export interface ApiProviderProps {
  client: ConsoleApi;
  children: React.ReactNode;
}

export function ApiProvider({ client, children }: ApiProviderProps) {
  return <ApiContext.Provider value={client}>{children}</ApiContext.Provider>;
}

export function useConsoleApi(): ConsoleApi {
  const ctx = useContext(ApiContext);
  if (!ctx) {
    throw new Error("Console API client not provided");
  }
  return ctx;
}
