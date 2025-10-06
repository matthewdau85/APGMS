import React from "react";
import { createRoot } from "react-dom/client";
import { QueryErrorResetBoundary } from "@tanstack/react-query";
import { AppProviders, AppShell } from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { GlobalErrorFallback } from "./components/GlobalErrorFallback";

const container = document.getElementById("root");

if (!container) {
  throw new Error("Root element with id 'root' was not found");
}

createRoot(container).render(
  <React.StrictMode>
    <AppProviders>
      <QueryErrorResetBoundary>
        {({ reset }) => (
          <ErrorBoundary
            onReset={reset}
            fallback={({ error, resetErrorBoundary }) => (
              <GlobalErrorFallback error={error} onRetry={resetErrorBoundary} />
            )}
          >
            <AppShell />
          </ErrorBoundary>
        )}
      </QueryErrorResetBoundary>
    </AppProviders>
  </React.StrictMode>,
);
