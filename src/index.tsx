import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ErrorBoundary } from "react-error-boundary";
import { Toaster } from "react-hot-toast";
import toast from "react-hot-toast";

import App from "./App";
import "./index.css";
import { isApiError } from "./api/client";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      onError: (error, query) => {
        if (query.state.errorUpdateCount > 1) return;
        notifyError(error);
      },
    },
    mutations: {
      onError: notifyError,
    },
  },
});

function notifyError(error: unknown) {
  if (isApiError(error)) {
    const suffix = error.requestId ? ` (request ${error.requestId})` : "";
    toast.error(`${error.message}${suffix}`);
  } else if (error instanceof Error) {
    toast.error(error.message);
  } else if (typeof error === "string") {
    toast.error(error);
  } else {
    toast.error("Unexpected error");
  }
}

function AppErrorFallback({ resetErrorBoundary }: { resetErrorBoundary: () => void }) {
  return (
    <div style={{ padding: 24, textAlign: "center" }}>
      <h1>Something went wrong</h1>
      <p>Try refreshing the page or clearing cached data.</p>
      <button className="button" onClick={() => { queryClient.clear(); resetErrorBoundary(); }}>
        Try again
      </button>
    </div>
  );
}

const root = ReactDOM.createRoot(document.getElementById("root") as HTMLElement);
root.render(
  <React.StrictMode>
    <ErrorBoundary FallbackComponent={AppErrorFallback} onReset={() => queryClient.clear()}>
      <QueryClientProvider client={queryClient}>
        <Toaster position="top-right" />
        <App />
      </QueryClientProvider>
    </ErrorBoundary>
  </React.StrictMode>
);
