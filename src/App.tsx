// src/App.tsx
import React from "react";
import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import AppLayout from "./components/AppLayout";
import { ComplianceProvider } from "./context/ComplianceContext";

import Dashboard from "./pages/Dashboard";
import BAS from "./pages/BAS";
import Settings from "./pages/Settings";
import Wizard from "./pages/Wizard";
import Audit from "./pages/Audit";
import Fraud from "./pages/Fraud";
import Integrations from "./pages/Integrations";
import Help from "./pages/Help";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ComplianceProvider>
        <Router>
          <Routes>
            <Route element={<AppLayout />}>
              <Route path="/" element={<Dashboard />} />
              <Route path="/bas" element={<BAS />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/wizard" element={<Wizard />} />
              <Route path="/audit" element={<Audit />} />
              <Route path="/fraud" element={<Fraud />} />
              <Route path="/integrations" element={<Integrations />} />
              <Route path="/help" element={<Help />} />
            </Route>
          </Routes>
        </Router>
      </ComplianceProvider>
    </QueryClientProvider>
  );
}
