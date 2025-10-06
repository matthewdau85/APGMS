import React from "react";
import { render, RenderOptions } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ConsoleApi } from "./api/client";
import { ApiProvider } from "./api/context";

interface RenderProvidersOptions extends Omit<RenderOptions, "queries"> {
  api: ConsoleApi;
}

export function renderWithProviders(ui: React.ReactElement, { api, ...options }: RenderProvidersOptions) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <ApiProvider client={api}>
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </ApiProvider>
    );
  }

  return render(ui, { wrapper: Wrapper, ...options });
}
