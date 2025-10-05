import React from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import { ConsoleApiClient } from "./api/client";
import { ApiProvider } from "./api/context";

const container = document.getElementById("root");
if (!container) {
  throw new Error("Root element not found");
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      staleTime: 15_000,
    },
  },
});

const apiClient = new ConsoleApiClient({ baseUrl: "/api" });

createRoot(container).render(
  <React.StrictMode>
    <ApiProvider client={apiClient}>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </ApiProvider>
  </React.StrictMode>
);
