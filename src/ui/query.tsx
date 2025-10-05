import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
const qc = new QueryClient();
export const WithQuery = ({ children }:{ children: React.ReactNode }) =>
  <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
