// src/App.tsx
import React from "react";
import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import AppLayout from "./components/AppLayout";

import Dashboard from "./pages/Dashboard";
import BAS from "./pages/BAS";
import Settings from "./pages/Settings";
import Wizard from "./pages/Wizard";
import Audit from "./pages/Audit";
import Fraud from "./pages/Fraud";
import Integrations from "./pages/Integrations";
import Help from "./pages/Help";
import InvoiceIngest from "./pages/InvoiceIngest";

export default function App() {
  return (
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
          <Route path="/invoice-ingest" element={<InvoiceIngest />} />
          <Route path="/help" element={<Help />} />
        </Route>
      </Routes>
    </Router>
  );
}
